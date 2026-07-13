#!/usr/bin/env python3
"""Import ZIDU reference price workbooks into Supabase products/product_specs.

Default mode is dry-run. Use --upload to write to Supabase.
Without --replace, the importer is intentionally conservative:
- product rows are matched by product code;
- matching specs are updated by spec name;
- missing specs are inserted with stock=0;
- existing stock is preserved;
- existing specs not present in the workbooks are not deleted.

With --replace, the old product catalogue and specs are cleared first, then
the workbook catalogue is inserted with the requested default stock for every
imported spec.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib import error, parse, request

import pandas as pd


ROOT = Path(__file__).resolve().parents[3]
REFERENCE_DIR = ROOT / "小程序的reference"
RETAIL_FILE = REFERENCE_DIR / "副本ZIDU紫都芳园 单方精油官方定价（2026.7）(1).xlsx"
RAW_FILE = REFERENCE_DIR / "副本2026.5.29更新-紫都精油报价.xlsx"
MINIPROGRAM_CONFIG = ROOT / "00_后台管理系统/zidu-miniprogram/utils/config.js"


@dataclass
class Spec:
  spec: str
  price: float
  cost: float = 0
  stock: int = 999
  safeStock: int = 10


@dataclass
class Product:
  code: str
  name: str
  series: str
  origin: str
  channel: str
  source: str
  specs: list[Spec] = field(default_factory=list)


def norm_text(value: Any) -> str:
  if value is None:
    return ""
  if isinstance(value, float) and math.isnan(value):
    return ""
  text = unicodedata.normalize("NFKC", str(value)).strip()
  text = re.sub(r"\s+", " ", text)
  return text


def norm_code(value: Any) -> str:
  return norm_text(value).upper()


def number(value: Any) -> float | None:
  text = norm_text(value)
  if not text or text in {"/", "-", "—", "NAN"}:
    return None
  text = text.replace(",", "").replace("¥", "").replace("￥", "").replace("元", "")
  match = re.search(r"-?\d+(?:\.\d+)?", text)
  if not match:
    return None
  return float(match.group(0))


def add_spec(product: Product, spec: str, price: Any) -> None:
  p = number(price)
  if p is None:
    return
  spec = norm_text(spec)
  if not spec:
    return
  product.specs.append(Spec(spec=spec, price=p))


def add_spec_price_text(product: Product, value: Any, default_spec: str = "1kg") -> None:
  text = norm_text(value)
  if not text or text in {"/", "-", "—"}:
    return
  match = re.search(r"([0-9]+(?:\.[0-9]+)?\s*(?:kg|g|ml|l|L|KG|G|ML))\s*[*xX×]\s*([0-9]+(?:\.[0-9]+)?)", text)
  if match:
    add_spec(product, match.group(1).replace(" ", ""), match.group(2))
    return
  add_spec(product, default_spec, value)


def split_50_100(product: Product, value: Any) -> None:
  text = norm_text(value)
  if not text or text in {"/", "-", "—"}:
    return
  parts = [p.strip() for p in text.split("/") if p.strip()]
  if len(parts) >= 2:
    add_spec(product, "50ml", parts[0])
    add_spec(product, "100ml", parts[1])
  else:
    add_spec(product, "50ml", text)


def add_product(products: dict[str, Product], product: Product) -> None:
  if not product.code or not product.name or not product.specs:
    return
  existing = products.get(product.code)
  if existing:
    seen = {s.spec for s in existing.specs}
    for spec in product.specs:
      if spec.spec not in seen:
        existing.specs.append(spec)
        seen.add(spec.spec)
    return
  products[product.code] = product


def parse_retail(products: dict[str, Product]) -> None:
  df = pd.read_excel(RETAIL_FILE, sheet_name="单方定价（零售）", header=None)
  for _, row in df.iloc[3:].iterrows():
    code = norm_code(row.get(0))
    name = norm_text(row.get(1))
    if not code or not name:
      continue
    product = Product(
      code=code,
      name=name,
      series="单方精油系列",
      origin=norm_text(row.get(3)) or "中国",
      channel="FINISHED",
      source="紫都芳园零售",
    )
    add_spec(product, "15ml", row.get(5))
    add_spec(product, "5ml", row.get(6))
    add_spec(product, "2ml", row.get(7))
    add_product(products, product)


def parse_raw_single(products: dict[str, Product]) -> None:
  df = pd.read_excel(RAW_FILE, sheet_name="纯单方精油", header=None)
  for _, row in df.iloc[2:].iterrows():
    code = norm_code(row.get(1))
    name = norm_text(row.get(2))
    if not code or not name:
      continue
    product = Product(
      code=code,
      name=name,
      series="单方精油系列",
      origin=norm_text(row.get(3)) or "中国",
      channel="RAW",
      source="紫都精油报价/纯单方精油",
    )
    for spec, col in [("1kg", 4), ("500g", 5), ("100ml", 6), ("10ml", 7), ("5ml", 8)]:
      add_spec(product, spec, row.get(col))
    add_product(products, product)


def parse_hydrosol_skincare(products: dict[str, Product]) -> None:
  df = pd.read_excel(RAW_FILE, sheet_name="纯露.膏霜", header=None)
  for _, row in df.iloc[2:].iterrows():
    left_code = norm_code(row.get(1))
    left_name = norm_text(row.get(2))
    if left_code and left_name:
      product = Product(
        code=left_code,
        name=left_name,
        series="纯露系列",
        origin="中国",
        channel="RAW",
        source="紫都精油报价/纯露",
      )
      add_spec_price_text(product, row.get(3), "1kg")
      add_product(products, product)

    right_code = norm_code(row.get(6))
    right_name = norm_text(row.get(7))
    if right_code and right_name:
      product = Product(
        code=right_code,
        name=right_name,
        series="专业护肤系列",
        origin="中国",
        channel="RAW",
        source="紫都精油报价/膏霜精华",
      )
      add_spec_price_text(product, row.get(8), "1kg")
      split_50_100(product, row.get(9))
      add_product(products, product)


def parse_base_oil(products: dict[str, Product]) -> None:
  df = pd.read_excel(RAW_FILE, sheet_name="基础油", header=None)
  for _, row in df.iloc[2:].iterrows():
    code = norm_code(row.get(1))
    name = norm_text(row.get(2))
    if not code or not name:
      continue
    product = Product(
      code=code,
      name=name,
      series="基础油系列",
      origin=norm_text(row.get(6)) or "中国",
      channel="RAW",
      source="紫都精油报价/基础油",
    )
    add_spec(product, "1kg", row.get(3))
    add_spec(product, "500ml", row.get(4))
    add_spec(product, "100ml", row.get(5))
    add_product(products, product)


def parse_massage_oil(products: dict[str, Product]) -> None:
  df = pd.read_excel(RAW_FILE, sheet_name="身体按摩油", header=None)
  for _, row in df.iloc[2:].iterrows():
    code = norm_code(row.get(1))
    name = norm_text(row.get(2))
    if not code or not name:
      continue
    product = Product(
      code=code,
      name=name,
      series="养生疗愈系列",
      origin="中国",
      channel="RAW",
      source="紫都精油报价/身体按摩油",
    )
    add_spec(product, "1kg", row.get(5))
    add_product(products, product)


def add_packaging_bottles(products: dict[str, Product]) -> None:
  # 整排/整箱规格的价格按整排/整箱总价录入；数量 1 = 1 排 / 1 箱。
  rows = [
    ("ZDBTL-01", "精油分装瓶 5ml", [("1-100个", 1), ("整排(255个/排)", 216.75), ("整箱(765个/箱)", 497.25)]),
    ("ZDBTL-02", "精油分装瓶 10ml", [("1-100个", 1), ("整排(192个/排)", 163.2), ("整箱(768个/箱)", 499.2)]),
    ("ZDBTL-03", "精油分装瓶 30ml", [("1-100个", 1), ("整排(110个/排)", 93.5), ("整箱(330个/箱)", 214.5)]),
    ("ZDBTL-04", "精油分装瓶 50ml", [("1-100个", 1.5), ("整排(88个/排)", 105.6), ("整箱(264个/箱)", 264)]),
    ("ZDBTL-05", "精油分装瓶 100ml", [("1-100个", 1.5), ("整排(70个/排)", 84), ("整箱(140个/箱)", 140)]),
    ("ZDBTL-06", "纯露分装瓶 100g", [("1-100个", 5), ("整箱(520个/箱)", 1820)]),
  ]
  for code, name, specs in rows:
    product = Product(
      code=code,
      name=name,
      series="瓶器包材",
      origin="中国",
      channel="BOTH",
      source="精油/纯露分装瓶报价",
    )
    for spec, price in specs:
      add_spec(product, spec, price)
    add_product(products, product)


def load_products() -> list[Product]:
  products: dict[str, Product] = {}
  parse_retail(products)
  parse_raw_single(products)
  parse_hydrosol_skincare(products)
  parse_base_oil(products)
  parse_massage_oil(products)
  add_packaging_bottles(products)
  return list(products.values())


def set_default_stock(products: list[Product], default_stock: int) -> None:
  for product in products:
    for spec in product.specs:
      spec.stock = default_stock


def read_supabase_config() -> tuple[str, str]:
  text = MINIPROGRAM_CONFIG.read_text(encoding="utf-8")
  url_match = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", text)
  key_match = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", text)
  if not url_match or not key_match:
    raise RuntimeError(f"Cannot read Supabase config from {MINIPROGRAM_CONFIG}")
  return url_match.group(1), key_match.group(1)


def supabase_request(base_url: str, anon_key: str, method: str, path: str, body: Any | None = None, prefer: str | None = None) -> Any:
  data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
  headers = {
    "apikey": anon_key,
    "Authorization": f"Bearer {anon_key}",
    "Content-Type": "application/json",
  }
  if prefer:
    headers["Prefer"] = prefer
  req = request.Request(base_url + path, data=data, headers=headers, method=method)
  last_error: Exception | None = None
  for attempt in range(4):
    try:
      with request.urlopen(req, timeout=40) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None
    except error.HTTPError as exc:
      detail = exc.read().decode("utf-8", errors="replace")
      if exc.code < 500 or attempt == 3:
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code} {detail}") from exc
      last_error = exc
    except (error.URLError, TimeoutError) as exc:
      if attempt == 3:
        raise RuntimeError(f"{method} {path} failed: {exc}") from exc
      last_error = exc
    time.sleep(0.8 * (attempt + 1))
  raise RuntimeError(f"{method} {path} failed: {last_error}")


def is_missing_channel_error(exc: Exception) -> bool:
  text = str(exc)
  return (
    "Could not find the 'channel' column" in text
    or "column products.channel does not exist" in text
    or ("schema cache" in text and "'channel'" in text)
  )


def is_missing_schema_error(exc: Exception) -> bool:
  text = str(exc)
  return (
    "PGRST204" in text
    or "PGRST205" in text
    or "Could not find" in text
    or "does not exist" in text
  )


def product_payload(product: Product, include_channel: bool = True) -> dict[str, Any]:
  payload = {
    "code": product.code,
    "name": product.name,
    "series": product.series,
    "origin": product.origin or "中国",
  }
  if include_channel:
    payload["channel"] = product.channel
  return payload


def safe_supabase_request(base_url: str, anon_key: str, method: str, path: str, body: Any | None = None, prefer: str | None = None) -> bool:
  try:
    supabase_request(base_url, anon_key, method, path, body, prefer)
    return True
  except RuntimeError as exc:
    if is_missing_schema_error(exc):
      return False
    raise


def spec_payload(spec: Spec, product_id: int | None = None, include_stock: bool = False) -> dict[str, Any]:
  payload: dict[str, Any] = {
    "spec": spec.spec,
    "price": spec.price,
    "cost": spec.cost,
    "safe_stock": spec.safeStock,
  }
  if product_id is not None:
    payload["product_id"] = product_id
  if include_stock:
    payload["stock"] = spec.stock
  return payload


def replace_catalog(base_url: str, anon_key: str) -> None:
  # Keep customer/order records, but detach live product references that would block catalogue replacement.
  safe_supabase_request(base_url, anon_key, "PATCH", "/rest/v1/order_items?batch_id=not.is.null", {"batch_id": None})
  safe_supabase_request(base_url, anon_key, "PATCH", "/rest/v1/purchase_order_items?product_id=not.is.null", {"product_id": None, "spec_id": None})
  safe_supabase_request(base_url, anon_key, "PATCH", "/rest/v1/purchase_order_items?spec_id=not.is.null", {"product_id": None, "spec_id": None})
  safe_supabase_request(base_url, anon_key, "DELETE", "/rest/v1/scenario_package_items?id=not.is.null")
  safe_supabase_request(base_url, anon_key, "DELETE", "/rest/v1/stock_adjustments?id=not.is.null")
  safe_supabase_request(base_url, anon_key, "DELETE", "/rest/v1/product_batches?id=not.is.null")
  safe_supabase_request(base_url, anon_key, "DELETE", "/rest/v1/product_specs?id=not.is.null")
  safe_supabase_request(base_url, anon_key, "DELETE", "/rest/v1/products?id=not.is.null")


def upload(products: list[Product], include_channel: bool = True, replace: bool = False) -> dict[str, int]:
  base_url, anon_key = read_supabase_config()
  if include_channel:
    try:
      supabase_request(base_url, anon_key, "GET", "/rest/v1/products?select=channel&limit=1")
    except RuntimeError as exc:
      if is_missing_channel_error(exc):
        raise RuntimeError(
          "Cloud products table is missing the channel column. "
          "Run supabase/migration_v10.sql first, or re-run with --skip-channel to upload prices/specs only."
        ) from exc
      raise

  if replace:
    replace_catalog(base_url, anon_key)

  rows = supabase_request(base_url, anon_key, "GET", "/rest/v1/products?select=*,specs:product_specs(*)&order=id")
  existing_by_code = {norm_code(row.get("code")): row for row in rows or []}
  counts = {"replaced_catalog": int(replace), "created_products": 0, "updated_products": 0, "created_specs": 0, "updated_specs": 0}

  for product in products:
    existing = existing_by_code.get(product.code)
    if existing:
      product_id = existing["id"]
      supabase_request(base_url, anon_key, "PATCH", f"/rest/v1/products?id=eq.{product_id}", product_payload(product, include_channel))
      counts["updated_products"] += 1
    else:
      created = supabase_request(base_url, anon_key, "POST", "/rest/v1/products?select=*", product_payload(product, include_channel), "return=representation")
      product_id = created[0]["id"]
      existing = {"specs": []}
      counts["created_products"] += 1

    existing_specs = {norm_text(spec.get("spec")): spec for spec in existing.get("specs", [])}
    for spec in product.specs:
      old = existing_specs.get(spec.spec)
      if old:
        supabase_request(base_url, anon_key, "PATCH", f"/rest/v1/product_specs?id=eq.{old['id']}", spec_payload(spec))
        counts["updated_specs"] += 1
      else:
        supabase_request(base_url, anon_key, "POST", "/rest/v1/product_specs", spec_payload(spec, product_id, include_stock=True))
        counts["created_specs"] += 1

  return counts


def summarize(products: list[Product]) -> dict[str, Any]:
  by_source: dict[str, int] = {}
  by_channel: dict[str, int] = {}
  by_series: dict[str, int] = {}
  spec_count = 0
  for product in products:
    by_source[product.source] = by_source.get(product.source, 0) + 1
    by_channel[product.channel] = by_channel.get(product.channel, 0) + 1
    by_series[product.series] = by_series.get(product.series, 0) + 1
    spec_count += len(product.specs)
  return {
    "products": len(products),
    "specs": spec_count,
    "by_source": by_source,
    "by_channel": by_channel,
    "by_series": by_series,
    "sample": [
      {
        "code": p.code,
        "name": p.name,
        "series": p.series,
        "origin": p.origin,
        "channel": p.channel,
        "specs": [s.__dict__ for s in p.specs],
      }
      for p in products[:10]
    ],
  }


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument("--upload", action="store_true", help="write parsed products to Supabase")
  parser.add_argument("--replace", action="store_true", help="clear old products/specs first, then insert the workbook catalogue")
  parser.add_argument("--skip-channel", action="store_true", help="upload prices/specs without RAW/FINISHED channel; use only before migration_v10 is applied")
  parser.add_argument("--default-stock", type=int, default=999, help="stock value for every imported spec; default: 999")
  parser.add_argument("--only-code-prefix", action="append", default=[], help="only import products whose code starts with this prefix; can be repeated")
  parser.add_argument("--json", type=Path, help="write normalized import data to JSON")
  args = parser.parse_args()

  if args.replace and args.only_code_prefix:
    parser.error("--replace cannot be used together with --only-code-prefix")

  products = load_products()
  if args.only_code_prefix:
    prefixes = tuple(norm_code(prefix) for prefix in args.only_code_prefix if norm_code(prefix))
    products = [p for p in products if p.code.startswith(prefixes)]
    if not products:
      print("ERROR: no products matched --only-code-prefix", file=sys.stderr)
      return 1

  set_default_stock(products, args.default_stock)
  summary = summarize(products)
  print(json.dumps(summary, ensure_ascii=False, indent=2))

  if args.json:
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(
      json.dumps([
        {
          "code": p.code,
          "name": p.name,
          "series": p.series,
          "origin": p.origin,
          "channel": p.channel,
          "source": p.source,
          "specs": [s.__dict__ for s in p.specs],
        }
        for p in products
      ], ensure_ascii=False, indent=2),
      encoding="utf-8",
    )
    print(f"Wrote {args.json}")

  if args.upload:
    try:
      result = upload(products, include_channel=not args.skip_channel, replace=args.replace)
    except RuntimeError as exc:
      print(f"ERROR: {exc}", file=sys.stderr)
      return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
  else:
    print("Dry-run only. Re-run with --upload to write to Supabase.")
  return 0


if __name__ == "__main__":
  sys.exit(main())
