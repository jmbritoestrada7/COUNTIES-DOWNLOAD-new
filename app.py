from __future__ import annotations

import json
import os
import re
import uuid
import threading
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook
from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_socketio import SocketIO, emit, join_room
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
PROJECT_DIR = DATA_DIR / "projects"
UPLOAD_DIR = DATA_DIR / "uploads"
PROJECT_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "local-development-secret")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

STATE_FIPS = {
    "AL":"01","AK":"02","AZ":"04","AR":"05","CA":"06","CO":"08","CT":"09","DE":"10","DC":"11","FL":"12",
    "GA":"13","HI":"15","ID":"16","IL":"17","IN":"18","IA":"19","KS":"20","KY":"21","LA":"22","ME":"23",
    "MD":"24","MA":"25","MI":"26","MN":"27","MS":"28","MO":"29","MT":"30","NE":"31","NV":"32","NH":"33",
    "NJ":"34","NM":"35","NY":"36","NC":"37","ND":"38","OH":"39","OK":"40","OR":"41","PA":"42","RI":"44",
    "SC":"45","SD":"46","TN":"47","TX":"48","UT":"49","VT":"50","VA":"51","WA":"53","WV":"54","WI":"55","WY":"56"
}
STATE_NAMES = {
    "ALABAMA":"AL","ALASKA":"AK","ARIZONA":"AZ","ARKANSAS":"AR","CALIFORNIA":"CA","COLORADO":"CO","CONNECTICUT":"CT",
    "DELAWARE":"DE","DISTRICT OF COLUMBIA":"DC","FLORIDA":"FL","GEORGIA":"GA","HAWAII":"HI","IDAHO":"ID","ILLINOIS":"IL",
    "INDIANA":"IN","IOWA":"IA","KANSAS":"KS","KENTUCKY":"KY","LOUISIANA":"LA","MAINE":"ME","MARYLAND":"MD",
    "MASSACHUSETTS":"MA","MICHIGAN":"MI","MINNESOTA":"MN","MISSISSIPPI":"MS","MISSOURI":"MO","MONTANA":"MT","NEBRASKA":"NE",
    "NEVADA":"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ","NEW MEXICO":"NM","NEW YORK":"NY","NORTH CAROLINA":"NC",
    "NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK","OREGON":"OR","PENNSYLVANIA":"PA","RHODE ISLAND":"RI",
    "SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD","TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT","VIRGINIA":"VA",
    "WASHINGTON":"WA","WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY"
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_path(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", project_id):
        raise ValueError("Invalid project id")
    return PROJECT_DIR / f"{project_id}.json"


def load_project(project_id: str) -> dict:
    path = project_path(project_id)
    if not path.exists():
        raise FileNotFoundError(project_id)
    return json.loads(path.read_text(encoding="utf-8"))


def save_project(project: dict) -> None:
    project["updated_at"] = now_iso()
    project_path(project["id"]).write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_state(value) -> tuple[str, str]:
    raw = str(value or "").strip().upper()
    abbr = raw if raw in STATE_FIPS else STATE_NAMES.get(raw, "")
    return abbr, STATE_FIPS.get(abbr, "")


def normalize_county(value) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+(county|parish|borough|census area|municipality|city and borough)$", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def find_column(df: pd.DataFrame, aliases: list[str]):
    normalized = {re.sub(r"[^a-z0-9]", "", str(c).lower()): c for c in df.columns}
    for alias in aliases:
        key = re.sub(r"[^a-z0-9]", "", alias.lower())
        if key in normalized:
            return normalized[key]
    return None



def parse_str(value, percent_formatted: bool = False) -> tuple[str, float | None]:
    """Return a display percentage and numeric percent value.

    Excel percentage-formatted cells store 134% as 1.34. When the cell format
    contains %, multiply by 100. Plain numeric values such as 134 remain 134.
    Text values ending in % are already expressed as percentages.
    """
    if value is None or value == "":
        return "", None
    raw = str(value).strip().replace(",", ".")
    if not raw:
        return "", None
    has_symbol = "%" in raw
    cleaned = re.sub(r"[^0-9.\-]", "", raw)
    try:
        number = float(cleaned)
    except (TypeError, ValueError):
        return raw, None
    if percent_formatted and not has_symbol:
        number *= 100
    elif not has_symbol and 0 <= number < 1:
        number *= 100
    formatted = f"{number:.2f}".rstrip("0").rstrip(".")
    return f"{formatted}%", number


STR_COLUMN_ALIASES = {
    "str_2_5": ["STR 2-5", "SRT 2-5", "STR_2_5", "STR 2 TO 5", "2-5"],
    "str_5_10": ["STR 5-10", "SRT 5-10", "STR_5_10", "STR 5 TO 10", "5-10"],
    "str_10_20": ["STR 10-20", "SRT 10-20", "STR_10_20", "STR 10 TO 20", "10-20"],
    "str_20_60": ["STR 20-60", "SRT 20-60", "STR_20_60", "STR 20 TO 60", "20-60"],
    "str_60_100": ["STR 60-100", "SRT 60-100", "STR_60_100", "STR 60 TO 100", "60-100"],
    "str_100_plus": ["STR 100+", "SRT 100+", "SRT 100- +", "STR 100- +", "STR_100_PLUS", "STR 100 PLUS", "100+"],
}


def county_identity(row: dict) -> tuple[str, str]:
    return str(row.get("state_fips", "")), str(row.get("county_key", ""))


def merge_existing_notes(new_counties: list[dict], old_counties: list[dict]) -> list[dict]:
    old_data = {county_identity(c): c for c in old_counties}
    for county in new_counties:
        previous = old_data.get(county_identity(county), {})
        for field in ("notes", "priority", "assigned_to", "next_review"):
            if not str(county.get(field, "")).strip() and previous.get(field):
                county[field] = previous[field]
    return new_counties


def read_counties_excel(path: Path) -> list[dict]:
    workbook = load_workbook(path, data_only=True, read_only=False)
    sheet = workbook.active
    header_values = [cell.value for cell in sheet[1]]
    df_headers = pd.DataFrame(columns=[str(v or "").strip() for v in header_values])

    county_col = find_column(df_headers, ["county", "county name", "condado", "county_name"])
    state_col = find_column(df_headers, ["state", "state code", "estado", "st"])
    status_col = find_column(df_headers, ["status", "estado descarga", "download status", "descargado"])
    date_col = find_column(df_headers, ["date", "download date", "fecha", "fecha descarga"])
    notes_col = find_column(df_headers, ["notes", "nota", "notas", "comments", "comentarios"])
    priority_col = find_column(df_headers, ["priority", "prioridad"])
    assigned_col = find_column(df_headers, ["assigned to", "assigned", "asignado a", "responsable"])
    review_col = find_column(df_headers, ["next review", "review date", "proxima revision", "próxima revisión"])
    str_col = find_column(df_headers, ["str", "sell through rate", "sell-through rate", "sell through", "tasa de venta", "porcentaje de venta", "avg str", "average of str"])
    str_band_cols = {key: find_column(df_headers, aliases) for key, aliases in STR_COLUMN_ALIASES.items()}
    if not county_col or not state_col:
        raise ValueError("El Excel debe incluir columnas COUNTY/CONDADO y STATE/ESTADO.")

    header_index = {str(v or "").strip(): i + 1 for i, v in enumerate(header_values)}

    def cell_value(row_number: int, column_name: str | None):
        if not column_name:
            return "", False
        cell = sheet.cell(row=row_number, column=header_index[column_name])
        return cell.value, "%" in str(cell.number_format or "")

    rows = []
    for row_number in range(2, sheet.max_row + 1):
        county_value, _ = cell_value(row_number, county_col)
        state_value, _ = cell_value(row_number, state_col)
        county = normalize_county(county_value)
        state, state_fips = normalize_state(state_value)
        if not county or not state_fips:
            continue

        avg_raw, avg_pct = cell_value(row_number, str_col)
        avg_display, avg_value = parse_str(avg_raw, avg_pct)
        band_data = {}
        for key, column_name in str_band_cols.items():
            raw, pct = cell_value(row_number, column_name)
            display, numeric = parse_str(raw, pct)
            band_data[key] = display
            band_data[f"{key}_value"] = numeric

        status_value, _ = cell_value(row_number, status_col)
        date_value, _ = cell_value(row_number, date_col)
        notes_value, _ = cell_value(row_number, notes_col)
        priority_value, _ = cell_value(row_number, priority_col)
        assigned_value, _ = cell_value(row_number, assigned_col)
        review_value, _ = cell_value(row_number, review_col)

        rows.append({
            "county": county,
            "county_key": county.casefold(),
            "state": state,
            "state_fips": state_fips,
            "status": str(status_value or "Downloaded").strip() or "Downloaded",
            "date": str(date_value or "").strip(),
            "notes": str(notes_value or "").strip(),
            "priority": str(priority_value or "").strip(),
            "assigned_to": str(assigned_value or "").strip(),
            "next_review": str(review_value or "").strip(),
            "str": avg_display,
            "str_value": avg_value,
            **band_data,
        })
    if not rows:
        raise ValueError("No se encontraron filas válidas de counties y estados.")
    return rows


@app.get("/")
def index():
    projects = []
    for path in sorted(PROJECT_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            p = json.loads(path.read_text(encoding="utf-8"))
            projects.append({"id": p["id"], "name": p.get("name", "Mapa"), "updated_at": p.get("updated_at", "")})
        except Exception:
            pass
    return render_template("index.html", projects=projects)


@app.post("/projects")
def create_project():
    name = (request.form.get("name") or "Mapa de Counties").strip()
    project_id = uuid.uuid4().hex[:12]
    project = {
        "id": project_id,
        "name": name,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "counties": [],
        "drawings": {"type": "FeatureCollection", "features": []},
    }
    save_project(project)
    return redirect(url_for("map_view", project_id=project_id))


@app.get("/map/<project_id>")
def map_view(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return "Mapa no encontrado", 404
    return render_template("map.html", project=project)


@app.get("/api/projects/<project_id>")
def project_data(project_id: str):
    try:
        return jsonify(load_project(project_id))
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "not found"}), 404


@app.post("/api/projects/<project_id>/excel")
def upload_excel(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Mapa no encontrado"}), 404
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Selecciona un archivo Excel."}), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in {".xlsx", ".xlsm"}:
        return jsonify({"error": "Usa un archivo .xlsx o .xlsm."}), 400
    filename = f"{project_id}_{secure_filename(file.filename)}"
    dest = UPLOAD_DIR / filename
    file.save(dest)
    try:
        counties = merge_existing_notes(read_counties_excel(dest), project.get("counties", []))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    project["counties"] = counties
    project["source_file"] = file.filename
    save_project(project)
    socketio.emit("counties_updated", {"counties": counties, "updated_at": project["updated_at"]}, to=project_id)
    return jsonify({"ok": True, "count": len(counties), "counties": counties})


@app.post("/api/projects/<project_id>/counties/notes")
def save_county_note(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Mapa no encontrado"}), 404

    data = request.get_json(silent=True) or {}
    state_fips = str(data.get("state_fips", "")).strip()
    county_key = str(data.get("county_key", "")).strip().casefold()
    notes = str(data.get("notes", "")).strip()[:5000]
    priority = str(data.get("priority", "")).strip()[:50]
    assigned_to = str(data.get("assigned_to", "")).strip()[:200]
    next_review = str(data.get("next_review", "")).strip()[:100]
    if not state_fips or not county_key:
        return jsonify({"error": "County inválido"}), 400

    updated = None
    for county in project.get("counties", []):
        if str(county.get("state_fips", "")) == state_fips and str(county.get("county_key", "")).casefold() == county_key:
            county["notes"] = notes
            county["priority"] = priority
            county["assigned_to"] = assigned_to
            county["next_review"] = next_review
            updated = county
            break
    if updated is None:
        return jsonify({"error": "County no encontrado en el Excel"}), 404

    save_project(project)
    socketio.emit(
        "county_note_updated",
        {"county": updated, "sender": data.get("sender"), "updated_at": project["updated_at"]},
        to=project_id,
    )
    return jsonify({"ok": True, "county": updated, "updated_at": project["updated_at"]})


@app.post("/api/projects/<project_id>/drawings")
def save_drawings(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Mapa no encontrado"}), 404
    data = request.get_json(silent=True) or {}
    drawings = data.get("drawings")
    if not isinstance(drawings, dict) or drawings.get("type") != "FeatureCollection":
        return jsonify({"error": "GeoJSON inválido"}), 400
    project["drawings"] = drawings
    save_project(project)
    socketio.emit("drawings_updated", {"drawings": drawings, "sender": data.get("sender")}, to=project_id)
    return jsonify({"ok": True, "updated_at": project["updated_at"]})


@socketio.on("join_project")
def join_project_event(data):
    project_id = str((data or {}).get("project_id", ""))
    try:
        load_project(project_id)
    except Exception:
        return
    join_room(project_id)
    emit("joined", {"project_id": project_id})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    production = os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RENDER")
    if not production:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=not bool(production),
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
