#!/usr/bin/env python3
"""
Парсер дозвільних документів e-construction.gov.ua для Львівської області.

Збирає:
- номер документа
- дата реєстрації
- статус
- назва / тип об'єкта
- адреса
- замовник
- посилання на детальну картку
- координати (якщо вдається витягнути)

Запуск:
  python scrape.py --days 90
  python scrape.py --from-date 2026-07-01 --to-date 2026-10-22 --max-pages 15
"""

import argparse
import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from dateutil import parser as date_parser
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout
from tqdm import tqdm

# ====================== НАЛАШТУВАННЯ ======================

BASE_URL = "https://e-construction.gov.ua"
LIST_URL = f"{BASE_URL}/document/optype=100"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

JSON_PATH = DATA_DIR / "constructions.json"
CSV_PATH = DATA_DIR / "constructions.csv"

# Паузи (не бій сервер)
PAGE_LOAD_TIMEOUT = 45000
BETWEEN_ITEMS_SLEEP = 1.2
BETWEEN_PAGES_SLEEP = 2.5

# Селектори (можуть змінюватися — якщо парсер зламався, першим ділом перевіряй їх)
SELECTORS = {
    "list_item": "div.el-card, .document-item, [class*='document'], a[href*='document_detail']",
    "detail_button": "a:has-text('Детальніше'), button:has-text('Детальніше')",
    "pagination_next": "button:has-text('Наступна'), .el-pagination .btn-next, a:has-text('Наступна')",
}


def parse_args():
    p = argparse.ArgumentParser(description="Парсер нової забудови Львівської області")
    p.add_argument("--days", type=int, default=90, help="Скільки днів назад брати (за замовчуванням 90)")
    p.add_argument("--from-date", type=str, help="Початкова дата YYYY-MM-DD")
    p.add_argument("--to-date", type=str, help="Кінцева дата YYYY-MM-DD")
    p.add_argument("--max-pages", type=int, default=30, help="Максимум сторінок списку")
    p.add_argument("--headless", action="store_true", default=True, help="Без вікна браузера")
    p.add_argument("--headed", action="store_true", help="З вікном браузера (для дебагу)")
    p.add_argument("--max-items", type=int, default=0, help="Максимум записів (0 = без ліміту)")
    return p.parse_args()


def clean_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def extract_doc_number(text: str) -> str:
    """Спроба витягнути номер типу ІУ101251203508 / ЛВ..."""
    m = re.search(r"[А-ЯІЇЄҐA-Z]{1,3}\d{8,}", text or "")
    return m.group(0) if m else ""


def try_parse_date(text: str) -> Optional[str]:
    if not text:
        return None
    try:
        dt = date_parser.parse(text, dayfirst=True, fuzzy=True)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None


def apply_region_filter(page: Page):
    """
    Спроба застосувати фільтр 'Область = Львівська'.
    Сайт на Element UI + Vue, тому логіка трохи крихка.
    """
    print("[*] Застосовую фільтр по області 'Львівська'...")

    # 1. Знаходимо інпут з placeholder "Область"
    oblast_input = page.locator('input.el-input__inner[placeholder="Область"]').first
    if oblast_input.count() == 0:
        # запасний варіант
        oblast_input = page.get_by_placeholder("Область")

    try:
        oblast_input.click(timeout=5000)
        oblast_input.fill("")
        oblast_input.type("Львівська", delay=80)
        time.sleep(1.5)

        # Клікаємо по першому варіанту в dropdown (якщо з’явився)
        dropdown_item = page.locator(".el-select-dropdown__item, .el-autocomplete-suggestion li, .el-cascader-node").filter(has_text=re.compile("Львів", re.I)).first
        if dropdown_item.count() > 0:
            dropdown_item.click(timeout=3000)
            print("[+] Обрано 'Львівська' з підказок")
        else:
            # Enter
            oblast_input.press("Enter")
            print("[~] Натиснуто Enter (підказка не знайдена)")
    except Exception as e:
        print(f"[!] Не вдалося повністю застосувати фільтр області: {e}")
        print("    Продовжую без гарантії фільтра. Перевір вручну або онови селектори.")

    time.sleep(2)


def apply_date_filter(page: Page, from_date: str, to_date: str):
    """Спроба встановити діапазон дат реєстрації."""
    print(f"[*] Встановлюю діапазон дат: {from_date} → {to_date}")
    try:
        # Шукаємо поля дати
        date_inputs = page.locator('input[placeholder*="Дата"], input[placeholder*="дата"], .el-date-editor input')
        count = date_inputs.count()
        if count >= 2:
            date_inputs.nth(0).fill(from_date)
            date_inputs.nth(1).fill(to_date)
            page.keyboard.press("Enter")
            print("[+] Дати встановлено")
        else:
            print("[~] Поля дат не знайдені автоматично — можна встановити вручну в headed-режимі")
    except Exception as e:
        print(f"[!] Помилка встановлення дат: {e}")


def collect_list_page_items(page: Page) -> List[Dict[str, Any]]:
    """Збирає базову інформацію зі списку на поточній сторінці."""
    items = []

    # Основний спосіб — посилання на деталі
    links = page.locator("a[href*='document_detail']")
    count = links.count()
    print(f"    Знайдено посилань на деталі: {count}")

    for i in range(count):
        try:
            link = links.nth(i)
            href = link.get_attribute("href") or ""
            full_url = urljoin(BASE_URL, href)

            # Беремо текст картки / батьківського блоку
            card = link.locator("xpath=ancestor::div[contains(@class,'el-card') or contains(@class,'document') or contains(@class,'item')][1]")
            if card.count() == 0:
                card = link.locator("xpath=..")

            text = clean_text(card.inner_text() if card.count() else link.inner_text())
            doc_num = extract_doc_number(text) or extract_doc_number(href)

            items.append({
                "doc_number": doc_num,
                "list_text": text[:500],
                "detail_url": full_url,
                "status": "",
                "reg_date": None,
            })
        except Exception:
            continue

    # Якщо посилань мало — fallback по тексту карток
    if len(items) < 3:
        cards = page.locator("div.el-card, [class*='document-card'], [class*='list-item']")
        for i in range(min(cards.count(), 50)):
            try:
                card = cards.nth(i)
                text = clean_text(card.inner_text())
                doc_num = extract_doc_number(text)
                if not doc_num:
                    continue
                # Шукаємо посилання всередині
                a = card.locator("a[href*='document_detail']").first
                href = a.get_attribute("href") if a.count() else ""
                items.append({
                    "doc_number": doc_num,
                    "list_text": text[:500],
                    "detail_url": urljoin(BASE_URL, href) if href else "",
                    "status": "",
                    "reg_date": None,
                })
            except Exception:
                continue

    # Унікалізуємо по номеру
    seen = set()
    unique = []
    for it in items:
        key = it["doc_number"] or it["detail_url"]
        if key and key not in seen:
            seen.add(key)
            unique.append(it)
    return unique


def parse_detail_page(page: Page, url: str) -> Dict[str, Any]:
    """Відкриває детальну картку і витягує поля."""
    data = {
        "object_name": "",
        "address": "",
        "customer": "",
        "org_issuer": "",
        "doc_type": "",
        "status_detail": "",
        "reg_date": None,
        "lat": None,
        "lon": None,
        "raw_text": "",
    }

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=PAGE_LOAD_TIMEOUT)
        time.sleep(1.5)

        body_text = clean_text(page.locator("body").inner_text())
        data["raw_text"] = body_text[:3000]

        # Прості евристики по тексту (сайт не завжди має зручні data-атрибути)
        # Назва об'єкта
        for label in ["Назва об'єкта", "Найменування об'єкта", "Об'єкт будівництва", "Назва"]:
            m = re.search(rf"{label}\s*[:\-]?\s*(.+?)(?:\n|$)", body_text, re.I)
            if m:
                data["object_name"] = clean_text(m.group(1))[:300]
                break

        # Адреса
        for label in ["Адреса", "Місце розташування", "Адреса об'єкта"]:
            m = re.search(rf"{label}\s*[:\-]?\s*(.+?)(?:\n|$)", body_text, re.I)
            if m:
                data["address"] = clean_text(m.group(1))[:400]
                break

        # Замовник
        for label in ["Замовник", "Заявник", "Замовник будівництва"]:
            m = re.search(rf"{label}\s*[:\-]?\s*(.+?)(?:\n|$)", body_text, re.I)
            if m:
                data["customer"] = clean_text(m.group(1))[:300]
                break

        # Орган
        for label in ["Орган, що видав", "Орган видачі", "Уповноважений орган"]:
            m = re.search(rf"{label}\s*[:\-]?\s*(.+?)(?:\n|$)", body_text, re.I)
            if m:
                data["org_issuer"] = clean_text(m.group(1))[:200]
                break

        # Дата
        for label in ["Дата реєстрації", "Дата внесення", "Дата"]:
            m = re.search(rf"{label}\s*[:\-]?\s*(\d{{1,2}}[./]\d{{1,2}}[./]\d{{2,4}})", body_text, re.I)
            if m:
                data["reg_date"] = try_parse_date(m.group(1))
                break

        # Координати (якщо є в тексті або в data-атрибутах)
        coord_m = re.search(r"(\d{2}\.\d{4,}),\s*(\d{2}\.\d{4,})", body_text)
        if coord_m:
            data["lat"] = float(coord_m.group(1))
            data["lon"] = float(coord_m.group(2))

        # Статус
        if "Діючий" in body_text:
            data["status_detail"] = "Діючий"
        elif "Архівний" in body_text:
            data["status_detail"] = "Архівний"

    except PlaywrightTimeout:
        print(f"    [!] Таймаут при відкритті {url}")
    except Exception as e:
        print(f"    [!] Помилка деталі {url}: {e}")

    return data


def save_results(records: List[Dict[str, Any]]):
    """Зберігає JSON + CSV."""
    # JSON
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "region": "Львівська область",
            "count": len(records),
            "items": records,
        }, f, ensure_ascii=False, indent=2)
    print(f"[+] Збережено JSON → {JSON_PATH}")

    # CSV
    try:
        import pandas as pd
        df = pd.DataFrame(records)
        preferred = [
            "doc_number", "reg_date", "object_name", "address", "customer",
            "status", "org_issuer", "lat", "lon", "detail_url"
        ]
        cols = [c for c in preferred if c in df.columns] + [c for c in df.columns if c not in preferred]
        df[cols].to_csv(CSV_PATH, index=False, encoding="utf-8-sig")
        print(f"[+] Збережено CSV  → {CSV_PATH}")
    except Exception as e:
        print(f"[!] CSV не збережено: {e}")


def main():
    args = parse_args()
    headless = args.headless and not args.headed

    # Дати
    if args.from_date and args.to_date:
        from_date = args.from_date
        to_date = args.to_date
    else:
        to_dt = datetime.now()
        from_dt = to_dt - timedelta(days=args.days)
        from_date = from_dt.strftime("%Y-%m-%d")
        to_date = to_dt.strftime("%Y-%m-%d")

    print("=" * 60)
    print("Парсер нової забудови — Львівська область")
    print(f"Період: {from_date} → {to_date}")
    print(f"Макс. сторінок: {args.max_pages}")
    print("=" * 60)

    all_records: List[Dict[str, Any]] = []
    seen_docs = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            locale="uk-UA",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1400, "height": 900},
        )
        page = context.new_page()
        page.set_default_timeout(PAGE_LOAD_TIMEOUT)

        print("[*] Відкриваю реєстр...")
        page.goto(LIST_URL, wait_until="domcontentloaded")
        time.sleep(3)

        # Фільтри
        apply_region_filter(page)
        apply_date_filter(page, from_date, to_date)

        # Чекаємо оновлення списку
        time.sleep(3)

        for page_num in range(1, args.max_pages + 1):
            print(f"\n[*] Сторінка списку {page_num}...")
            items = collect_list_page_items(page)
            if not items:
                print("    Порожньо — зупиняюсь")
                break

            for item in tqdm(items, desc=f"  Деталі p{page_num}"):
                doc = item.get("doc_number") or item.get("detail_url")
                if not doc or doc in seen_docs:
                    continue
                seen_docs.add(doc)

                if not item.get("detail_url"):
                    continue

                detail = parse_detail_page(page, item["detail_url"])
                time.sleep(BETWEEN_ITEMS_SLEEP)

                record = {
                    "doc_number": item.get("doc_number") or extract_doc_number(detail.get("raw_text", "")),
                    "reg_date": detail.get("reg_date") or item.get("reg_date"),
                    "object_name": detail.get("object_name") or "",
                    "address": detail.get("address") or "",
                    "customer": detail.get("customer") or "",
                    "status": detail.get("status_detail") or item.get("status") or "",
                    "org_issuer": detail.get("org_issuer") or "",
                    "lat": detail.get("lat"),
                    "lon": detail.get("lon"),
                    "detail_url": item["detail_url"],
                    "list_snippet": item.get("list_text", "")[:200],
                }
                all_records.append(record)

                if args.max_items and len(all_records) >= args.max_items:
                    break

            if args.max_items and len(all_records) >= args.max_items:
                break

            # Наступна сторінка
            try:
                next_btn = page.locator(SELECTORS["pagination_next"]).first
                if next_btn.count() and next_btn.is_enabled():
                    next_btn.click()
                    time.sleep(BETWEEN_PAGES_SLEEP)
                else:
                    print("    Більше сторінок немає")
                    break
            except Exception:
                print("    Не вдалося перейти на наступну сторінку")
                break

        browser.close()

    print(f"\n[+] Зібрано записів: {len(all_records)}")
    save_results(all_records)
    print("Готово.")


if __name__ == "__main__":
    main()
