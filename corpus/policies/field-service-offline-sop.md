# Field Service — Offline Knowledge Pack SOP

**Document ID:** OPS-FS-2026-012  
**Effective:** 15 May 2026  
**Owner:** Diego Morales, Head of Technical Support  
**Audience:** Field service engineers, Solutions Engineers

---

## Context

Field engineers often work inside customer plants where guest Wi‑Fi is unavailable and gloves make typing impractical. This SOP defines how local knowledge packs stay fresh so answers about parts and accounts do not require a call to the office.

## Rules

1. **Docked refresh:** When a field laptop is on Meridian network (office or approved VPN), the offline knowledge pack refreshes automatically. Cadence target: **at least weekly**.
2. **Stale warning:** If the pack is older than **10 days**, the assistant must surface a “knowledge may be stale” warning before quoting commercial figures.
3. **No cloud AI:** Inference and retrieval for customer/commercial content stay on the device or a Meridian-controlled peer. This is non-negotiable (Legal / board).
4. **Hands-free path:** Preferred plant workflow is spoken question → grounded answer with citation → spoken response when TTS is available.
5. **Nameplates / defects:** Engineers may photograph a nameplate or defective part and ask alongside the document corpus (image + text in one context) when the VLM path is enabled on that device.

## Minimum device note

The weakest supported field laptop is a **2019 business laptop, 8GB RAM, integrated graphics**. Model/quantization selection must degrade gracefully rather than fail silently.
