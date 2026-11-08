#!/usr/bin/env python3
"""
Embeds Adobe/CAI TrustMark invisible neural watermarks ("jaredn.dev") and signs
all generated WebP images in public/photos/ with a C2PA (ES256) manifest.

Pipeline per photo:
  1. Ensure persistent ECDSA P-256 Root CA + Leaf Signing Cert exist in keys/
     and publish public cert chain to public/.well-known/c2pa_certs.pem.
  2. For any WebP in public/photos/<slug>/ that does not yet have a C2PA chunk
     (or when --force is passed):
     - Compute the 256x256 TrustMark Q (BCH_3) residual once per base photo.
     - Apply the invisible watermark residual to each responsive WebP size
       (640w, 1280w, 2048w) while preserving the clean EXIF (Artist/Copyright).
     - Sign the WebP container with C2PA (stds.schema-org.CreativeWork,
       c2pa.training-mining opt-out, and c2pa.soft-binding for TrustMark).
"""

import datetime
import io
import json
import os
import pathlib
import re
import sys

import c2pa
import numpy as np
import torch
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from PIL import Image
from torchvision import transforms
from trustmark import TrustMark

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
PHOTOS_DIR = PROJECT_ROOT / "public" / "photos"
KEYS_DIR = PROJECT_ROOT / "keys"
WELL_KNOWN_DIR = PROJECT_ROOT / "public" / ".well-known"

PRIV_KEY_PATH = KEYS_DIR / "c2pa_private.pem"
CERT_CHAIN_PATH = KEYS_DIR / "c2pa_certs.pem"
PUBLIC_CERT_PATH = WELL_KNOWN_DIR / "c2pa_certs.pem"

WATERMARK_SECRET = "jaredn.dev"
WEBP_QUALITY = 80


def ensure_certificates() -> tuple[bytes, bytes]:
    """Load or generate persistent ECDSA P-256 C2PA certificate chain and private key."""
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    WELL_KNOWN_DIR.mkdir(parents=True, exist_ok=True)

    if PRIV_KEY_PATH.exists() and CERT_CHAIN_PATH.exists():
        certs_pem = CERT_CHAIN_PATH.read_bytes()
        key_pem = PRIV_KEY_PATH.read_bytes()
        if not PUBLIC_CERT_PATH.exists() or PUBLIC_CERT_PATH.read_bytes() != certs_pem:
            PUBLIC_CERT_PATH.write_bytes(certs_pem)
        return certs_pem, key_pem

    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Self-signed Root CA
    root_key = ec.generate_private_key(ec.SECP256R1())
    root_name = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Jared Nussbaum"),
            x509.NameAttribute(NameOID.COMMON_NAME, "Jared Nussbaum C2PA Root CA"),
        ]
    )
    root_cert = (
        x509.CertificateBuilder()
        .subject_name(root_name)
        .issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(root_key.public_key()),
            critical=False,
        )
        .sign(root_key, hashes.SHA256())
    )

    # 2. End-entity C2PA Signing Certificate
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    leaf_name = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Jared Nussbaum (jaredn.dev)"),
            x509.NameAttribute(NameOID.COMMON_NAME, "Jared Nussbaum"),
        ]
    )
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(root_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]),
            critical=False,
        )
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("jaredn.dev"),
                    x509.UniformResourceIdentifier("https://jaredn.dev"),
                ]
            ),
            critical=False,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(leaf_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(root_key.public_key()),
            critical=False,
        )
        .sign(root_key, hashes.SHA256())
    )

    certs_pem = leaf_cert.public_bytes(serialization.Encoding.PEM) + root_cert.public_bytes(
        serialization.Encoding.PEM
    )
    key_pem = leaf_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )

    PRIV_KEY_PATH.write_bytes(key_pem)
    CERT_CHAIN_PATH.write_bytes(certs_pem)
    PUBLIC_CERT_PATH.write_bytes(certs_pem)
    print(f"Generated new C2PA keypair in {KEYS_DIR.relative_to(PROJECT_ROOT)}/ and published cert to {PUBLIC_CERT_PATH.relative_to(PROJECT_ROOT)}")
    return certs_pem, key_pem


def has_c2pa_manifest(webp_path: pathlib.Path) -> bool:
    """Fast check for an embedded C2PA RIFF chunk or JUMBF signature in a WebP file."""
    try:
        data = webp_path.read_bytes()
        return b"c2pa.signature" in data and b"stds.schema-org.CreativeWork" in data
    except OSError:
        return False


@torch.no_grad()
def compute_residual_256(tm: TrustMark, im: Image.Image, secret_tensor: torch.Tensor) -> torch.Tensor:
    """Compute the 1x3x256x256 zero-mean TrustMark residual for a base photo."""
    cover_crop = tm.get_the_image_for_processing(im)
    cover_256 = cover_crop.resize((tm.model_resolution_enc, tm.model_resolution_enc), Image.Resampling.BILINEAR)
    cover_t = transforms.ToTensor()(cover_256).unsqueeze(0).to(tm.device) * 2.0 - 1.0
    stego_t, _ = tm.encoder(cover_t, secret_tensor)
    residual = stego_t.clamp(-1, 1) - cover_t
    residual = residual - residual.mean(dim=(2, 3), keepdim=True)
    return residual


@torch.no_grad()
def apply_residual_to_image(tm: TrustMark, im: Image.Image, residual_256: torch.Tensor, strength: float = 1.0) -> Image.Image:
    """Upsample the 256x256 TrustMark residual and feather-paste onto an image of any resolution."""
    cover_crop = tm.get_the_image_for_processing(im)
    w, h = cover_crop.size
    res_up = torch.nn.functional.interpolate(residual_256, size=(h, w), mode="bilinear")
    res_np = res_up.permute(0, 2, 3, 1).cpu().numpy().astype("f4")[0]
    stego_crop = np.clip(res_np * strength + np.array(cover_crop) / 127.5 - 1.0, -1, 1) * 127.5 + 127.5
    stego_full = tm.put_the_image_after_processing(stego_crop, np.asarray(im).astype(np.uint8))
    return Image.fromarray(stego_full.astype(np.uint8))


def build_c2pa_manifest(title: str) -> dict:
    return {
        "claim_generator": "jaredn.dev/1.0",
        "title": title,
        "assertions": [
            {
                "label": "stds.schema-org.CreativeWork",
                "data": {
                    "@context": "https://schema.org",
                    "@type": "Photograph",
                    "author": [
                        {
                            "@type": "Person",
                            "name": "Jared Nussbaum",
                            "url": "https://jaredn.dev",
                        }
                    ],
                    "copyrightHolder": {
                        "@type": "Person",
                        "name": "Jared Nussbaum",
                    },
                    "copyrightNotice": "© Jared Nussbaum. All rights reserved.",
                },
            },
            {
                "label": "c2pa.training-mining",
                "data": {
                    "entries": {
                        "c2pa.ai_generative_training": {"use": "notAllowed"},
                        "c2pa.ai_inference": {"use": "notAllowed"},
                        "c2pa.ai_training": {"use": "notAllowed"},
                        "c2pa.data_mining": {"use": "notAllowed"},
                    }
                },
            },
            {
                "label": "cawg.training-mining",
                "data": {
                    "entries": {
                        "cawg.ai_generative_training": {"use": "notAllowed"},
                        "cawg.ai_inference": {"use": "notAllowed"},
                        "cawg.ai_training": {"use": "notAllowed"},
                        "cawg.data_mining": {"use": "notAllowed"},
                    }
                },
            },
            {
                "label": "c2pa.soft-binding",
                "data": {
                    "alg": "com.adobe.trustmark.Q",
                    "blocks": [
                        {
                            "scope": {},
                            "value": WATERMARK_SECRET,
                        }
                    ],
                },
            },
        ],
    }


def main() -> None:
    force = "--force" in sys.argv
    c2pa.load_settings(json.dumps({"builder": {"thumbnail": {"enabled": False}}}))
    certs_pem, key_pem = ensure_certificates()
    signer = c2pa.Signer.from_info(
        c2pa.C2paSignerInfo(
            alg=b"es256",
            sign_cert=certs_pem,
            private_key=key_pem,
            ta_url=None,
        )
    )

    # Group WebP files by (slug, base_name)
    groups: dict[tuple[str, str], list[pathlib.Path]] = {}
    size_re = re.compile(r"^(.+)-(\d+)\.webp$")
    for slug_dir in sorted(PHOTOS_DIR.iterdir()):
        if not slug_dir.is_dir():
            continue
        for webp_file in sorted(slug_dir.glob("*.webp")):
            if not force and has_c2pa_manifest(webp_file):
                continue
            m = size_re.match(webp_file.name)
            base_name = m.group(1) if m else webp_file.stem
            groups.setdefault((slug_dir.name, base_name), []).append(webp_file)

    if not groups:
        print("TrustMark + C2PA: all WebP files already watermarked and signed.")
        return

    tm = TrustMark(
        verbose=False,
        model_type="Q",
        encoding_type=TrustMark.Encoding.BCH_3,
        loadRemover=False,
    )
    secret_np = tm.ecc.encode_text([WATERMARK_SECRET])
    secret_tensor = torch.from_numpy(secret_np).float().to(tm.device)

    total_files = sum(len(v) for v in groups.values())
    processed = 0

    for (slug, base_name), paths in groups.items():
        # Pick largest file to compute the 256x256 residual once per photo
        paths_sorted = sorted(paths, key=lambda p: p.stat().st_size, reverse=True)
        largest_im = Image.open(paths_sorted[0])
        exif_bytes = largest_im.info.get("exif")
        largest_rgb = largest_im.convert("RGB")
        residual_256 = compute_residual_256(tm, largest_rgb, secret_tensor)

        for webp_path in paths:
            im = Image.open(webp_path)
            cur_exif = im.info.get("exif") or exif_bytes
            rgb = im.convert("RGB")

            # 1. Embed TrustMark invisible pixel watermark
            wm_rgb = apply_residual_to_image(tm, rgb, residual_256)

            # 2. Encode WebP in-memory with preserved EXIF
            webp_buf = io.BytesIO()
            save_kwargs = {"format": "WEBP", "quality": WEBP_QUALITY}
            if cur_exif:
                save_kwargs["exif"] = cur_exif
            wm_rgb.save(webp_buf, **save_kwargs)
            webp_buf.seek(0)

            # 3. Sign WebP with C2PA manifest
            builder = c2pa.Builder(build_c2pa_manifest(webp_path.name))
            builder.set_intent(
                c2pa.C2paBuilderIntent.CREATE,
                c2pa.C2paDigitalSourceType.COMPUTATIONAL_CAPTURE,
            )
            signed_buf = io.BytesIO()
            builder.sign(signer, "image/webp", webp_buf, signed_buf)

            webp_path.write_bytes(signed_buf.getvalue())
            processed += 1

    print(f"TrustMark + C2PA: watermarked and signed {processed}/{total_files} WebP files ({len(groups)} photos).")


if __name__ == "__main__":
    main()
