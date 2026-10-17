"""CLI: generate product tour videos (green arrow + Adam VO)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import get_db
from app.services.product_tour_generator import (
    generate_all_product_tours,
    generate_product_tour,
    list_tour_catalog,
)


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print("Usage: run_product_tours.py [all|catalog|<product_key>]")
        for t in list_tour_catalog():
            print(f"  {t['product_key']:24} {t['title']} ({t['steps']} steps)")
        return 0
    key = args[0]
    with get_db() as db:
        if key == "all":
            r = generate_all_product_tours(db, website_id="ls")
            print(r)
            return 0 if r.get("generated") else 1
        if key == "catalog":
            for t in list_tour_catalog():
                print(t)
            return 0
        r = generate_product_tour(db, product_key=key, website_id="ls")
        print(r)
        return 0 if r.get("status") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
