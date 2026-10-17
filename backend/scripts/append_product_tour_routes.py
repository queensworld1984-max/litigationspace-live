from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app" / "routers" / "growth.py"
text = p.read_text(encoding="utf-8")
if "product-tours/catalog" in text:
    print("already present")
    raise SystemExit(0)

addon = r'''

# ================================================================
# PRODUCT TOURS — green arrow pointer demos + Adam VO
# ================================================================

PRODUCT_DEMOS_DIR = "/var/www/litigationspace-staging/data/product_demos"


@router.get("/product-tours/catalog")
async def product_tours_catalog(current_user: dict = Depends(get_current_user)):
    from app.services.product_tour_generator import list_tour_catalog
    return {"items": list_tour_catalog()}


@router.get("/product-tours")
async def list_product_tours(site: str = "ls", limit: int = 50, current_user: dict = Depends(get_current_user)):
    from app.services.product_tour_generator import ensure_schema
    with get_db() as db:
        ensure_schema(db)
        rows = db.execute(
            "SELECT * FROM product_demo_videos WHERE website_id = ? ORDER BY created_at DESC LIMIT ?",
            (site, limit),
        ).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            if d.get("script"):
                try:
                    d["script"] = json.loads(d["script"])
                except Exception:
                    pass
            items.append(d)
        return {"items": items, "total": len(items)}


@router.post("/product-tours/generate")
async def generate_one_product_tour(
    product_key: str = Query(...),
    site: str = "ls",
    current_user: dict = Depends(get_current_user),
):
    from app.services.product_tour_generator import generate_product_tour, ensure_schema
    with get_db() as db:
        ensure_schema(db)
        result = generate_product_tour(db, product_key=product_key, website_id=site)
        if result.get("status") != "success":
            raise HTTPException(status_code=400, detail=result.get("detail") or "Generation failed")
        return result


@router.post("/product-tours/generate-all")
async def generate_all_product_tours_endpoint(
    site: str = "ls",
    current_user: dict = Depends(get_current_user),
):
    from app.services.product_tour_generator import generate_all_product_tours, ensure_schema
    with get_db() as db:
        ensure_schema(db)
        return generate_all_product_tours(db, website_id=site)


@router.get("/product-tours/{video_id}/download")
async def download_product_tour(video_id: str, current_user: dict = Depends(get_current_user)):
    from fastapi.responses import FileResponse
    from app.services.product_tour_generator import ensure_schema
    with get_db() as db:
        ensure_schema(db)
        row = db.execute("SELECT * FROM product_demo_videos WHERE id = ?", (video_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demo not found")
        path = os.path.join(PRODUCT_DEMOS_DIR, row["video_path"])
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Video file missing")
        return FileResponse(path, media_type="video/mp4", filename=f"{row['title']}.mp4")


@router.get("/product-tours/{video_id}/thumbnail")
async def product_tour_thumbnail(video_id: str):
    from fastapi.responses import FileResponse
    with get_db() as db:
        row = db.execute(
            "SELECT thumbnail_path FROM product_demo_videos WHERE id = ?",
            (video_id,),
        ).fetchone()
        if not row or not row["thumbnail_path"]:
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        path = os.path.join(PRODUCT_DEMOS_DIR, row["thumbnail_path"])
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Thumbnail missing")
        return FileResponse(path, media_type="image/png")


@router.get("/product-tours/{video_id}/stream")
async def stream_product_tour(video_id: str, current_user: dict = Depends(get_current_user)):
    from fastapi.responses import FileResponse
    with get_db() as db:
        row = db.execute("SELECT * FROM product_demo_videos WHERE id = ?", (video_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demo not found")
        path = os.path.join(PRODUCT_DEMOS_DIR, row["video_path"])
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Video file missing")
        return FileResponse(path, media_type="video/mp4")
'''

p.write_text(text.rstrip() + "\n" + addon + "\n", encoding="utf-8")
print("appended product tour routes to", p)
