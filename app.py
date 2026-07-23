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
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
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
FIPS_STATES = {v: k for k, v in STATE_FIPS.items()}

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


PROJECT_SCHEMA_VERSION = 5


def migrate_project(project: dict) -> tuple[dict, bool]:
    """Upgrade older stored projects without changing their permanent links."""
    changed = False
    if not isinstance(project, dict):
        raise ValueError("Invalid project data")

    version = int(project.get("schema_version") or 1)
    project.setdefault("counties", [])
    project.setdefault("drawings", {"type": "FeatureCollection", "features": []})

    drawings = project.get("drawings")
    if not isinstance(drawings, dict) or drawings.get("type") != "FeatureCollection":
        project["drawings"] = {"type": "FeatureCollection", "features": []}
        drawings = project["drawings"]
        changed = True

    for index, feature in enumerate(drawings.get("features") or [], start=1):
        if not isinstance(feature, dict):
            continue
        props = feature.setdefault("properties", {})
        if not props.get("id"):
            props["id"] = uuid.uuid4().hex
            changed = True
        if not str(props.get("name") or "").strip():
            props["name"] = f"Unnamed Area {index}"
            changed = True
        if not props.get("shapeType"):
            geom_type = str((feature.get("geometry") or {}).get("type") or "")
            props["shapeType"] = "Circle" if geom_type == "Point" and props.get("radius") else "Polygon"
            changed = True
        if not props.get("color"):
            props["color"] = "#7c3aed"
            changed = True
        if "visible" not in props:
            props["visible"] = True
            changed = True

    default_settings = {
        "state_filter": "",
        "str_min": None,
        "str_max": None,
        "search_filter": "",
        "layers": {
            "counties": True,
            "county_labels": True,
            "str_colors": True,
            "drawings": True,
            "drawing_labels": True,
        },
    }
    settings = project.setdefault("view_settings", {})
    for key, value in default_settings.items():
        if key not in settings:
            settings[key] = value.copy() if isinstance(value, dict) else value
            changed = True
    layers = settings.setdefault("layers", {})
    for key, value in default_settings["layers"].items():
        if key not in layers:
            layers[key] = value
            changed = True

    if version != PROJECT_SCHEMA_VERSION:
        project["schema_version"] = PROJECT_SCHEMA_VERSION
        changed = True
    return project, changed


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_path(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", project_id):
        raise ValueError("Invalid project id")
    return PROJECT_DIR / f"{project_id}.json"


def validate_project_id(project_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{12}", str(project_id or "")):
        raise ValueError("Invalid project id")
    return project_id


class ProjectStorage:
    """Persist project JSON locally and, when configured, in Cloudflare R2.

    Render's normal filesystem is ephemeral. R2 is the source of truth in
    production; the local copy is only a fast cache and a development fallback.
    """

    def __init__(self) -> None:
        self.account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
        self.access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        self.secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        self.bucket = os.environ.get("R2_BUCKET_NAME", "").strip()
        self.prefix = os.environ.get("R2_PROJECT_PREFIX", "projects").strip().strip("/") or "projects"
        self.endpoint = os.environ.get("R2_ENDPOINT_URL", "").strip()
        self.client = None

        configured = all([self.account_id, self.access_key, self.secret_key, self.bucket])
        if configured:
            endpoint_url = self.endpoint or f"https://{self.account_id}.r2.cloudflarestorage.com"
            self.client = boto3.client(
                service_name="s3",
                endpoint_url=endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name="auto",
                config=Config(signature_version="s3v4", retries={"max_attempts": 4, "mode": "standard"}),
            )

    @property
    def mode(self) -> str:
        return "r2" if self.client else "local"

    def key(self, project_id: str) -> str:
        validate_project_id(project_id)
        return f"{self.prefix}/{project_id}.json"

    def save(self, project: dict) -> None:
        project_id = validate_project_id(str(project.get("id", "")))
        payload = json.dumps(project, ensure_ascii=False, indent=2).encode("utf-8")

        # Always keep a local cache so local development works without R2.
        project_path(project_id).write_bytes(payload)

        if self.client:
            try:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=self.key(project_id),
                    Body=payload,
                    ContentType="application/json; charset=utf-8",
                    CacheControl="no-store",
                )
            except (BotoCoreError, ClientError) as exc:
                raise RuntimeError(f"Could not save the project to Cloudflare R2: {exc}") from exc

    def load(self, project_id: str) -> dict:
        validate_project_id(project_id)
        if self.client:
            try:
                response = self.client.get_object(Bucket=self.bucket, Key=self.key(project_id))
                project = json.loads(response["Body"].read().decode("utf-8"))
                # Refresh the local cache after a successful remote read.
                project_path(project_id).write_text(
                    json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                return project
            except self.client.exceptions.NoSuchKey:
                pass
            except ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code", ""))
                if code not in {"NoSuchKey", "404", "NotFound"}:
                    raise RuntimeError(f"Could not read the project from Cloudflare R2: {exc}") from exc
            except BotoCoreError as exc:
                raise RuntimeError(f"Could not connect to Cloudflare R2: {exc}") from exc

        path = project_path(project_id)
        if not path.exists():
            raise FileNotFoundError(project_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def delete(self, project_id: str) -> None:
        validate_project_id(project_id)
        path = project_path(project_id)
        if path.exists():
            path.unlink()
        if self.client:
            try:
                self.client.delete_object(Bucket=self.bucket, Key=self.key(project_id))
            except (BotoCoreError, ClientError) as exc:
                raise RuntimeError(f"Could not delete the project from Cloudflare R2: {exc}") from exc

    def list_projects(self) -> list[dict]:
        projects_by_id: dict[str, dict] = {}

        if self.client:
            token = None
            while True:
                args = {"Bucket": self.bucket, "Prefix": f"{self.prefix}/", "MaxKeys": 1000}
                if token:
                    args["ContinuationToken"] = token
                try:
                    result = self.client.list_objects_v2(**args)
                except (BotoCoreError, ClientError) as exc:
                    raise RuntimeError(f"Could not list projects from Cloudflare R2: {exc}") from exc
                for obj in result.get("Contents", []):
                    key = str(obj.get("Key", ""))
                    match = re.fullmatch(rf"{re.escape(self.prefix)}/([a-f0-9]{{12}})\.json", key)
                    if not match:
                        continue
                    project_id = match.group(1)
                    try:
                        project = self.load(project_id)
                        projects_by_id[project_id] = project
                    except Exception:
                        continue
                if not result.get("IsTruncated"):
                    break
                token = result.get("NextContinuationToken")

        # Include local-only projects when running without R2 or during migration.
        for path in PROJECT_DIR.glob("*.json"):
            try:
                project = json.loads(path.read_text(encoding="utf-8"))
                projects_by_id.setdefault(project["id"], project)
            except Exception:
                continue

        return sorted(projects_by_id.values(), key=lambda p: p.get("updated_at", ""), reverse=True)


storage = ProjectStorage()


def load_project(project_id: str) -> dict:
    project, changed = migrate_project(storage.load(project_id))
    if changed:
        project["updated_at"] = now_iso()
        storage.save(project)
    return project


def save_project(project: dict) -> None:
    project, _ = migrate_project(project)
    project["updated_at"] = now_iso()
    storage.save(project)


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
        raise ValueError("The Excel file must include COUNTY and STATE columns.")

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
        raise ValueError("No valid county and state rows were found.")
    return rows


def read_counties_csv(path: Path) -> list[dict]:
    """Read a CSV containing at minimum County and State columns.

    STR columns are optional. Counties without STR are intentionally retained
    and displayed with a neutral gray color in the map.
    """
    last_error = None
    df = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(path, dtype=object, encoding=encoding)
            break
        except UnicodeDecodeError as exc:
            last_error = exc
    if df is None:
        raise ValueError(f"Could not read the CSV file: {last_error}")

    county_col = find_column(df, ["county", "county name", "condado", "county_name"])
    state_col = find_column(df, ["state", "state code", "estado", "st"])
    status_col = find_column(df, ["status", "download status", "descargado"])
    date_col = find_column(df, ["date", "download date", "fecha", "fecha descarga"])
    notes_col = find_column(df, ["notes", "nota", "notas", "comments", "comentarios"])
    priority_col = find_column(df, ["priority", "prioridad"])
    assigned_col = find_column(df, ["assigned to", "assigned", "asignado a", "responsable"])
    review_col = find_column(df, ["next review", "review date", "proxima revision", "próxima revisión"])
    str_col = find_column(df, ["str", "sell through rate", "sell-through rate", "sell through", "avg str", "average of str"])
    str_band_cols = {key: find_column(df, aliases) for key, aliases in STR_COLUMN_ALIASES.items()}
    if not county_col or not state_col:
        raise ValueError("The CSV file must include COUNTY and STATE columns.")

    def value(row, col):
        if not col:
            return ""
        val = row.get(col, "")
        return "" if pd.isna(val) else val

    rows = []
    for _, row in df.iterrows():
        county = normalize_county(value(row, county_col))
        state, state_fips = normalize_state(value(row, state_col))
        if not county or not state_fips:
            continue
        avg_display, avg_value = parse_str(value(row, str_col), False)
        band_data = {}
        for key, col in str_band_cols.items():
            display, numeric = parse_str(value(row, col), False)
            band_data[key] = display
            band_data[f"{key}_value"] = numeric
        rows.append({
            "county": county, "county_key": county.casefold(), "state": state, "state_fips": state_fips,
            "status": str(value(row, status_col) or "Selected").strip() or "Selected",
            "date": str(value(row, date_col) or "").strip(),
            "notes": str(value(row, notes_col) or "").strip(),
            "priority": str(value(row, priority_col) or "").strip(),
            "assigned_to": str(value(row, assigned_col) or "").strip(),
            "next_review": str(value(row, review_col) or "").strip(),
            "str": avg_display, "str_value": avg_value, **band_data,
        })
    if not rows:
        raise ValueError("No valid county and state rows were found.")
    return rows


@app.get("/")
def index():
    storage_error = ""
    try:
        raw_projects = storage.list_projects()
    except RuntimeError as exc:
        storage_error = str(exc)
        raw_projects = []
    projects = [
        {"id": p["id"], "name": p.get("name", "Map"), "updated_at": p.get("updated_at", "")}
        for p in raw_projects
    ]
    return render_template(
        "index.html",
        projects=projects,
        storage_mode=storage.mode,
        storage_error=storage_error,
    )


@app.get("/health")
def health():
    return jsonify({"ok": True, "storage": storage.mode})


@app.post("/projects")
def create_project():
    name = (request.form.get("name") or "County Map").strip()
    project_id = uuid.uuid4().hex[:12]
    project = {
        "id": project_id,
        "name": name,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "schema_version": PROJECT_SCHEMA_VERSION,
        "counties": [],
        "drawings": {"type": "FeatureCollection", "features": []},
        "view_settings": {
            "state_filter": "", "str_min": None, "str_max": None, "search_filter": "",
            "layers": {"counties": True, "county_labels": True, "str_colors": True, "drawings": True, "drawing_labels": True},
        },
    }
    save_project(project)
    return redirect(url_for("map_view", project_id=project_id))


@app.get("/map/<project_id>")
def map_view(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return "Map not found", 404
    return render_template("map.html", project=project, storage_mode=storage.mode)


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
        return jsonify({"error": "Map not found"}), 404
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Select an Excel file."}), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in {".xlsx", ".xlsm", ".csv"}:
        return jsonify({"error": "Use an .xlsx, .xlsm, or .csv file."}), 400
    filename = f"{project_id}_{secure_filename(file.filename)}"
    dest = UPLOAD_DIR / filename
    file.save(dest)
    try:
        imported = read_counties_csv(dest) if ext == ".csv" else read_counties_excel(dest)
        counties = merge_existing_notes(imported, project.get("counties", []))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    project["counties"] = counties
    project["source_file"] = file.filename
    save_project(project)
    socketio.emit("counties_updated", {"counties": counties, "updated_at": project["updated_at"]}, to=project_id)
    return jsonify({"ok": True, "count": len(counties), "counties": counties})


@app.post("/api/projects/<project_id>/counties/activate")
def activate_county(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Map not found"}), 404
    data = request.get_json(silent=True) or {}
    state_fips = str(data.get("state_fips") or "").zfill(2)
    county = normalize_county(data.get("county"))
    state = FIPS_STATES.get(state_fips, "")
    if not state or not county:
        return jsonify({"error": "Invalid county"}), 400
    county_key = county.casefold()
    for existing in project.get("counties", []):
        if existing.get("state_fips") == state_fips and existing.get("county_key") == county_key:
            return jsonify({"ok": True, "county": existing, "already_active": True})
    county_data = {
        "county": county, "county_key": county_key, "state": state, "state_fips": state_fips,
        "status": "Manually selected", "date": "", "notes": "", "priority": "",
        "assigned_to": "", "next_review": "", "str": "", "str_value": None,
    }
    for key in STR_COLUMN_ALIASES:
        county_data[key] = ""
        county_data[f"{key}_value"] = None
    project.setdefault("counties", []).append(county_data)
    project["counties"].sort(key=lambda c: (c.get("state", ""), c.get("county", "")))
    save_project(project)
    socketio.emit("counties_updated", {"counties": project["counties"], "updated_at": project["updated_at"]}, to=project_id)
    return jsonify({"ok": True, "county": county_data, "counties": project["counties"]})


@app.post("/api/projects/<project_id>/counties/notes")
def save_county_note(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Map not found"}), 404

    data = request.get_json(silent=True) or {}
    state_fips = str(data.get("state_fips", "")).strip()
    county_key = str(data.get("county_key", "")).strip().casefold()
    notes = str(data.get("notes", "")).strip()[:5000]
    priority = str(data.get("priority", "")).strip()[:50]
    assigned_to = str(data.get("assigned_to", "")).strip()[:200]
    next_review = str(data.get("next_review", "")).strip()[:100]
    if not state_fips or not county_key:
        return jsonify({"error": "Invalid county"}), 400

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
        return jsonify({"error": "County was not found in the Excel file"}), 404

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
        return jsonify({"error": "Map not found"}), 404
    data = request.get_json(silent=True) or {}
    drawings = data.get("drawings")
    if not isinstance(drawings, dict) or drawings.get("type") != "FeatureCollection":
        return jsonify({"error": "Invalid GeoJSON"}), 400
    project["drawings"] = drawings
    save_project(project)
    socketio.emit("drawings_updated", {"drawings": drawings, "sender": data.get("sender")}, to=project_id)
    return jsonify({"ok": True, "updated_at": project["updated_at"]})


@app.post("/api/projects/<project_id>/settings")
def save_project_settings(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Map not found"}), 404
    data = request.get_json(silent=True) or {}
    settings = data.get("view_settings")
    if not isinstance(settings, dict):
        return jsonify({"error": "Invalid settings"}), 400
    allowed_layers = {"counties", "county_labels", "str_colors", "drawings", "drawing_labels"}
    clean = {
        "state_filter": str(settings.get("state_filter") or "")[:2].upper(),
        "str_min": settings.get("str_min") if isinstance(settings.get("str_min"), (int, float)) else None,
        "str_max": settings.get("str_max") if isinstance(settings.get("str_max"), (int, float)) else None,
        "search_filter": str(settings.get("search_filter") or "")[:200],
        "layers": {k: bool((settings.get("layers") or {}).get(k, True)) for k in allowed_layers},
    }
    project["view_settings"] = clean
    save_project(project)
    socketio.emit("settings_updated", {"view_settings": clean, "sender": data.get("sender")}, to=project_id)
    return jsonify({"ok": True, "view_settings": clean, "updated_at": project["updated_at"]})


@app.post("/api/projects/<project_id>/rename")
def rename_project(project_id: str):
    try:
        project = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Map not found"}), 404
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()[:150]
    if not name:
        return jsonify({"error": "Enter a project name"}), 400
    project["name"] = name
    save_project(project)
    socketio.emit("project_renamed", {"name": name}, to=project_id)
    return jsonify({"ok": True, "name": name})


@app.post("/api/projects/<project_id>/duplicate")
def duplicate_project(project_id: str):
    try:
        source = load_project(project_id)
    except (FileNotFoundError, ValueError):
        return jsonify({"error": "Map not found"}), 404
    clone = json.loads(json.dumps(source))
    clone["id"] = uuid.uuid4().hex[:12]
    clone["name"] = f"{source.get('name', 'Map')} Copy"
    clone["created_at"] = now_iso()
    clone["updated_at"] = now_iso()
    save_project(clone)
    return jsonify({"ok": True, "id": clone["id"], "url": url_for("map_view", project_id=clone["id"])})


@app.delete("/api/projects/<project_id>")
def delete_project(project_id: str):
    try:
        load_project(project_id)
        storage.delete(project_id)
    except FileNotFoundError:
        return jsonify({"error": "Map not found"}), 404
    except ValueError:
        return jsonify({"error": "Invalid project id"}), 400
    return jsonify({"ok": True})


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
