#!/usr/bin/env python3
"""
Syncs public/photos/ to Cloudflare R2 bucket `jaredn-photos` using boto3 with
parallel uploads, correct WebP Content-Type, and immutable cache headers.
"""

import concurrent.futures
import hashlib
import mimetypes
import os
import pathlib
import sys

import boto3
from botocore.config import Config

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
PHOTOS_DIR = PROJECT_ROOT / "public" / "photos"
ENV_LOCAL_PATH = PROJECT_ROOT / ".env.local"

# Credentials from environment or .env.local fallback
def load_env():
    env = {}
    if ENV_LOCAL_PATH.exists():
        for line in ENV_LOCAL_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    return env

local_env = load_env()

def require_env(key: str) -> str:
    val = os.environ.get(key) or local_env.get(key)
    if not val:
        sys.exit(f"Error: Missing required environment variable {key}. Set it in your environment or .env.local")
    return val

ACCOUNT_ID = require_env("R2_ACCOUNT_ID")
ACCESS_KEY_ID = require_env("R2_ACCESS_KEY_ID")
SECRET_ACCESS_KEY = require_env("R2_SECRET_ACCESS_KEY")
BUCKET_NAME = os.environ.get("R2_BUCKET_NAME") or local_env.get("R2_BUCKET_NAME") or "jaredn-photos"
ENDPOINT_URL = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"


def main():
    if not PHOTOS_DIR.exists():
        print(f"No photos found at {PHOTOS_DIR}")
        return

    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT_URL,
        aws_access_key_id=ACCESS_KEY_ID,
        aws_secret_access_key=SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(max_pool_connections=20),
    )

    print(f"Fetching remote object list from R2 bucket '{BUCKET_NAME}'...")
    remote_objects = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET_NAME):
        for obj in page.get("Contents", []):
            remote_objects[obj["Key"]] = obj.get("ETag", "").strip('"')

    local_files = []
    local_keys = set()
    for slug_dir in sorted(PHOTOS_DIR.iterdir()):
        if not slug_dir.is_dir():
            continue
        for f in sorted(slug_dir.glob("*.webp")):
            rel_key = f"{slug_dir.name}/{f.name}"
            local_files.append((f, rel_key))
            local_keys.add(rel_key)

    def file_md5(path):
        h = hashlib.md5()
        with open(path, "rb") as fp:
            for chunk in iter(lambda: fp.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    to_upload = []
    for f, rel_key in local_files:
        if rel_key not in remote_objects or remote_objects[rel_key] != file_md5(f):
            to_upload.append((f, rel_key))

    # Identify and delete remote files that were deleted or excluded locally
    stale_keys = [k for k in remote_objects if k not in local_keys]
    if stale_keys:
        print(f"Pruning {len(stale_keys)} stale photos from R2 bucket...")
        for i in range(0, len(stale_keys), 1000):
            batch = [{"Key": k} for k in stale_keys[i : i + 1000]]
            s3.delete_objects(Bucket=BUCKET_NAME, Delete={"Objects": batch})
        print(f"Successfully pruned {len(stale_keys)} stale objects.")

    print(f"Found {len(local_files)} local photos across trips. {len(remote_objects)} in R2. {len(to_upload)} to upload.")

    if not to_upload:
        print("All photos are up to date on R2!")
        return

    def upload_one(item):
        file_path, key = item
        s3.upload_file(
            str(file_path),
            BUCKET_NAME,
            key,
            ExtraArgs={
                "ContentType": "image/webp",
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )
        return key

    uploaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(upload_one, item): item for item in to_upload}
        for future in concurrent.futures.as_completed(futures):
            key = future.result()
            uploaded += 1
            if uploaded % 25 == 0 or uploaded == len(to_upload):
                print(f"Uploaded {uploaded}/{len(to_upload)}: {key}")

    print(f"Sync complete. Successfully uploaded {uploaded} photos to Cloudflare R2 ({BUCKET_NAME}).")


if __name__ == "__main__":
    main()
