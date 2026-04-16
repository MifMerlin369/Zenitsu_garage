"""
Zenitsu Garage — Backend Flask
Production-ready pour Render.com
"""
from flask import Flask, request, jsonify, send_from_directory
import base64, re
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3, jwt, os
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__, static_folder="frontend")
CORS(app, resources={r"/api/*": {"origins": "*"}})

SECRET_KEY = os.environ.get("SECRET_KEY", "zenitsu-change-moi-en-production")

# Sur Render, on utilise /data pour la persistance (Disk monté)
# En local, on reste dans le dossier courant
DATA_DIR   = os.environ.get("DATA_DIR", ".")
DB_PATH    = os.path.join(DATA_DIR, "zenitsu.db")
PHOTOS_DIR = os.path.join(DATA_DIR, "photos")
os.makedirs(PHOTOS_DIR, exist_ok=True)

# ══════════════════════════════════════════════════════════════════════
# DATABASE
# ══════════════════════════════════════════════════════════════════════

def get_db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c

def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role     TEXT NOT NULL DEFAULT 'technician',
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS clients (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            nom        TEXT NOT NULL,
            tel        TEXT,
            email      TEXT,
            adresse    TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vehicles (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id       INTEGER,
            vin             TEXT UNIQUE,
            matricule       TEXT NOT NULL,
            marque          TEXT,
            modele          TEXT,
            annee           INTEGER,
            couleur         TEXT,
            carburant       TEXT DEFAULT 'essence',
            transmission    TEXT DEFAULT 'manuelle',
            created_at      TEXT NOT NULL,
            FOREIGN KEY(client_id) REFERENCES clients(id)
        );

        CREATE TABLE IF NOT EXISTS dossiers (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            numero              TEXT UNIQUE NOT NULL,
            vehicle_id          INTEGER NOT NULL,
            client_id           INTEGER NOT NULL,
            technician          TEXT NOT NULL,
            -- Statut & type
            statut              TEXT NOT NULL DEFAULT 'en_attente',
            type_intervention   TEXT DEFAULT 'reparation',
            urgence             TEXT DEFAULT 'normal',
            -- Dates
            date_entree         TEXT NOT NULL,
            date_sortie_prevue  TEXT,
            date_sortie_reelle  TEXT,
            -- Kilometrage
            km_entree           INTEGER,
            km_prochain_entretien INTEGER,
            -- Diagnostic
            panne_description   TEXT,
            panne_resolution    TEXT,
            pieces_changees     TEXT,
            garantie_mois       INTEGER DEFAULT 0,
            observations        TEXT,
            -- Financier
            type_tarif          TEXT DEFAULT 'facture',
            cout_pieces         REAL DEFAULT 0,
            cout_main_oeuvre    REAL DEFAULT 0,
            remise              REAL DEFAULT 0,
            -- Meta
            created_at          TEXT NOT NULL,
            updated_at          TEXT,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
            FOREIGN KEY(client_id)  REFERENCES clients(id)
        );

        CREATE TABLE IF NOT EXISTS dossier_photos (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            dossier_id INTEGER NOT NULL,
            filename   TEXT NOT NULL,
            caption    TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY(dossier_id) REFERENCES dossiers(id)
        );

        CREATE TABLE IF NOT EXISTS dossier_logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            dossier_id INTEGER NOT NULL,
            user       TEXT NOT NULL,
            action     TEXT NOT NULL,
            detail     TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(dossier_id) REFERENCES dossiers(id)
        );

        CREATE TABLE IF NOT EXISTS dossier_pannes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            dossier_id  INTEGER NOT NULL,
            description TEXT NOT NULL,
            regle       INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            updated_at  TEXT,
            FOREIGN KEY(dossier_id) REFERENCES dossiers(id)
        );
        """)
        db.commit()

        # Seed users
        if not db.execute("SELECT 1 FROM users WHERE username='admin'").fetchone():
            now = _now()
            for u, p, r in [("admin","admin123","admin"),("technicien1","tech123","technician")]:
                db.execute("INSERT INTO users(username,password,role,created_at) VALUES(?,?,?,?)",
                           (u, generate_password_hash(p), r, now))
            db.commit()

def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def _gen_numero(db):
    year = datetime.now().year
    row = db.execute(
        "SELECT COUNT(*) FROM dossiers WHERE numero LIKE ?", (f"GAR-{year}-%",)
    ).fetchone()[0]
    return f"GAR-{year}-{str(row+1).zfill(4)}"

# ══════════════════════════════════════════════════════════════════════
# AUTH
# ══════════════════════════════════════════════════════════════════════

def token_required(f):
    @wraps(f)
    def dec(*a, **kw):
        auth = request.headers.get("Authorization","")
        if not auth.startswith("Bearer "):
            return jsonify({"error":"Token manquant"}), 401
        try:
            request.user = jwt.decode(auth.split()[1], SECRET_KEY, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return jsonify({"error":"Token expiré"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error":"Token invalide"}), 401
        return f(*a, **kw)
    return dec

def admin_only(f):
    @wraps(f)
    @token_required
    def dec(*a, **kw):
        if request.user.get("role") != "admin":
            return jsonify({"error":"Admin requis"}), 403
        return f(*a, **kw)
    return dec

def vld(data, fields):
    return [f for f in fields if not str(data.get(f,"")).strip()]

def log_action(db, dossier_id, user, action, detail=""):
    db.execute("INSERT INTO dossier_logs(dossier_id,user,action,detail,created_at) VALUES(?,?,?,?,?)",
               (dossier_id, user, action, detail, _now()))

# ══════════════════════════════════════════════════════════════════════
# STATIC
# ══════════════════════════════════════════════════════════════════════

@app.route("/")
def index(): return send_from_directory("frontend","index.html")

@app.route("/<path:p>")
def static_f(p): return send_from_directory("frontend", p)

# ══════════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/login", methods=["POST"])
def login():
    d = request.get_json(silent=True) or {}
    if vld(d, ["username","password"]):
        return jsonify({"error":"Champs manquants"}), 400
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE username=?", (d["username"].strip(),)).fetchone()
    if not row or not check_password_hash(row["password"], d["password"]):
        return jsonify({"error":"Identifiants invalides"}), 401
    token = jwt.encode({
        "user_id": row["id"], "username": row["username"], "role": row["role"],
        "exp": datetime.utcnow() + timedelta(hours=10)
    }, SECRET_KEY, algorithm="HS256")
    return jsonify({"token":token, "username":row["username"], "role":row["role"]})

@app.route("/api/users", methods=["GET"])
@admin_only
def list_users():
    with get_db() as db:
        rows = db.execute("SELECT id,username,role,created_at FROM users").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/users/<int:uid>", methods=["PUT"])
@admin_only
def update_user(uid):
    d = request.get_json(silent=True) or {}
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            return jsonify({"error":"Utilisateur introuvable"}), 404
        new_username = d.get("username", row["username"]).strip()
        new_role     = d.get("role", row["role"])
        # Vérifier unicité si changement de nom
        if new_username != row["username"]:
            conflict = db.execute("SELECT 1 FROM users WHERE username=? AND id!=?",
                                  (new_username, uid)).fetchone()
            if conflict:
                return jsonify({"error":"Identifiant déjà utilisé"}), 409
        # Mot de passe : seulement si fourni
        if d.get("password","").strip():
            new_hash = generate_password_hash(d["password"])
        else:
            new_hash = row["password"]
        db.execute("UPDATE users SET username=?, password=?, role=? WHERE id=?",
                   (new_username, new_hash, new_role, uid))
        db.commit()
    return jsonify({"success": True})

@app.route("/api/users/<int:uid>/logs", methods=["GET"])
@admin_only
def user_logs(uid):
    with get_db() as db:
        row = db.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            return jsonify({"error":"Introuvable"}), 404
        logs = db.execute("""
            SELECT dl.*, d.numero
            FROM dossier_logs dl
            JOIN dossiers d ON d.id = dl.dossier_id
            WHERE dl.user = ?
            ORDER BY dl.created_at DESC
            LIMIT 100
        """, (row["username"],)).fetchall()
        total = db.execute(
            "SELECT COUNT(*) FROM dossier_logs WHERE user=?", (row["username"],)
        ).fetchone()[0]
    return jsonify({"logs": [dict(l) for l in logs], "total": total,
                    "username": row["username"]})

@app.route("/api/users", methods=["POST"])
@admin_only
def create_user():
    d = request.get_json(silent=True) or {}
    if vld(d, ["username","password"]):
        return jsonify({"error":"Champs manquants"}), 400
    try:
        with get_db() as db:
            db.execute("INSERT INTO users(username,password,role,created_at) VALUES(?,?,?,?)",
                       (d["username"].strip(), generate_password_hash(d["password"]),
                        d.get("role","technician"), _now()))
            db.commit()
        return jsonify({"success":True}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error":"Utilisateur existant"}), 409

# ══════════════════════════════════════════════════════════════════════
# CLIENTS
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/clients", methods=["GET"])
@token_required
def list_clients():
    q = request.args.get("q","").strip()
    with get_db() as db:
        if q:
            like = f"%{q.lower()}%"
            rows = db.execute("""
                SELECT c.*, COUNT(v.id) as nb_vehicles
                FROM clients c LEFT JOIN vehicles v ON v.client_id=c.id
                WHERE LOWER(c.nom) LIKE ? OR c.tel LIKE ? OR c.email LIKE ?
                GROUP BY c.id ORDER BY c.nom""", (like,like,like)).fetchall()
        else:
            rows = db.execute("""
                SELECT c.*, COUNT(v.id) as nb_vehicles
                FROM clients c LEFT JOIN vehicles v ON v.client_id=c.id
                GROUP BY c.id ORDER BY c.nom""").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/clients/<int:cid>", methods=["GET"])
@token_required
def get_client(cid):
    with get_db() as db:
        c = db.execute("SELECT * FROM clients WHERE id=?", (cid,)).fetchone()
        if not c: return jsonify({"error":"Introuvable"}), 404
        vehicles = db.execute(
            "SELECT * FROM vehicles WHERE client_id=? ORDER BY created_at DESC", (cid,)
        ).fetchall()
    return jsonify({**dict(c), "vehicles": [dict(v) for v in vehicles]})

@app.route("/api/clients", methods=["POST"])
@token_required
def create_client():
    d = request.get_json(silent=True) or {}
    if vld(d, ["nom"]):
        return jsonify({"error":"Nom requis"}), 400
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO clients(nom,tel,email,adresse,created_at) VALUES(?,?,?,?,?)",
            (d["nom"].strip(), d.get("tel",""), d.get("email",""),
             d.get("adresse",""), _now()))
        db.commit()
    return jsonify({"success":True, "id": cur.lastrowid}), 201

@app.route("/api/clients/<int:cid>", methods=["PUT"])
@token_required
def update_client(cid):
    d = request.get_json(silent=True) or {}
    with get_db() as db:
        db.execute("UPDATE clients SET nom=?,tel=?,email=?,adresse=? WHERE id=?",
                   (d.get("nom",""), d.get("tel",""), d.get("email",""),
                    d.get("adresse",""), cid))
        db.commit()
    return jsonify({"success":True})

# ══════════════════════════════════════════════════════════════════════
# VEHICLES
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/vehicles", methods=["GET"])
@token_required
def list_vehicles():
    q = request.args.get("q","").strip()
    with get_db() as db:
        if q:
            like = f"%{q.lower()}%"
            rows = db.execute("""
                SELECT v.*, c.nom as client_nom, c.tel as client_tel,
                       COUNT(d.id) as nb_dossiers,
                       MAX(d.date_entree) as derniere_visite
                FROM vehicles v
                LEFT JOIN clients c ON c.id=v.client_id
                LEFT JOIN dossiers d ON d.vehicle_id=v.id
                WHERE LOWER(v.matricule) LIKE ? OR LOWER(v.vin) LIKE ?
                   OR LOWER(v.marque) LIKE ? OR LOWER(v.modele) LIKE ?
                   OR LOWER(c.nom) LIKE ?
                GROUP BY v.id ORDER BY derniere_visite DESC""",
                (like,like,like,like,like)).fetchall()
        else:
            rows = db.execute("""
                SELECT v.*, c.nom as client_nom, c.tel as client_tel,
                       COUNT(d.id) as nb_dossiers,
                       MAX(d.date_entree) as derniere_visite
                FROM vehicles v
                LEFT JOIN clients c ON c.id=v.client_id
                LEFT JOIN dossiers d ON d.vehicle_id=v.id
                GROUP BY v.id ORDER BY derniere_visite DESC""").fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/vehicles/<int:vid>", methods=["GET"])
@token_required
def get_vehicle(vid):
    with get_db() as db:
        v = db.execute("""
            SELECT v.*, c.nom as client_nom, c.tel as client_tel,
                   c.email as client_email, c.adresse as client_adresse
            FROM vehicles v LEFT JOIN clients c ON c.id=v.client_id
            WHERE v.id=?""", (vid,)).fetchone()
        if not v: return jsonify({"error":"Introuvable"}), 404
        dossiers = db.execute("""
            SELECT d.*, c.nom as client_nom
            FROM dossiers d JOIN clients c ON c.id=d.client_id
            WHERE d.vehicle_id=? ORDER BY d.date_entree DESC""", (vid,)).fetchall()
    return jsonify({**dict(v), "dossiers": [dict(d) for d in dossiers]})

@app.route("/api/vehicles/lookup", methods=["GET"])
@token_required
def lookup_vehicle():
    """Recherche par plaque ou VIN pour auto-remplissage formulaire"""
    q = request.args.get("q","").strip()
    if not q: return jsonify({"error":"Paramètre requis"}), 400
    with get_db() as db:
        row = db.execute("""
            SELECT v.*, c.nom as client_nom, c.tel as client_tel,
                   c.email as client_email, c.adresse as client_adresse,
                   c.id as client_id_found,
                   MAX(d.km_prochain_entretien) as km_alerte,
                   MAX(d.km_entree) as last_km
            FROM vehicles v
            LEFT JOIN clients c ON c.id=v.client_id
            LEFT JOIN dossiers d ON d.vehicle_id=v.id
            WHERE LOWER(v.matricule)=LOWER(?) OR LOWER(v.vin)=LOWER(?)
            GROUP BY v.id LIMIT 1""", (q,q)).fetchone()
    if not row: return jsonify({"found": False})
    return jsonify({"found": True, **dict(row)})

@app.route("/api/vehicles", methods=["POST"])
@token_required
def create_vehicle():
    d = request.get_json(silent=True) or {}
    if vld(d, ["matricule"]):
        return jsonify({"error":"Plaque requise"}), 400
    try:
        with get_db() as db:
            cur = db.execute("""
                INSERT INTO vehicles(client_id,vin,matricule,marque,modele,
                                     annee,couleur,carburant,transmission,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (d.get("client_id"), d.get("vin","").strip() or None,
                 d["matricule"].strip(), d.get("marque",""), d.get("modele",""),
                 d.get("annee"), d.get("couleur",""),
                 d.get("carburant","essence"), d.get("transmission","manuelle"), _now()))
            db.commit()
        return jsonify({"success":True, "id": cur.lastrowid}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error":"VIN déjà enregistré"}), 409

# ══════════════════════════════════════════════════════════════════════
# DOSSIERS
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/dossiers", methods=["GET"])
@token_required
def list_dossiers():
    q      = request.args.get("q","").strip()
    statut = request.args.get("statut","").strip()
    urgence= request.args.get("urgence","").strip()
    type_i = request.args.get("type","").strip()

    sql = """
        SELECT d.*, c.nom as client_nom, c.tel as client_tel,
               v.matricule, v.marque, v.modele, v.annee, v.vin,
               v.id as vehicle_id
        FROM dossiers d
        JOIN clients c  ON c.id=d.client_id
        JOIN vehicles v ON v.id=d.vehicle_id
        WHERE 1=1
    """
    params = []
    if q:
        like = f"%{q.lower()}%"
        sql += """ AND (
            LOWER(c.nom) LIKE ? OR LOWER(v.matricule) LIKE ? OR
            LOWER(v.vin) LIKE ? OR LOWER(d.technician) LIKE ? OR
            d.date_entree LIKE ? OR LOWER(v.marque) LIKE ? OR
            LOWER(v.modele) LIKE ? OR LOWER(d.numero) LIKE ? OR
            LOWER(d.panne_description) LIKE ?
        )"""
        params += [like]*9
    if statut:  sql += " AND d.statut=?";  params.append(statut)
    if urgence: sql += " AND d.urgence=?"; params.append(urgence)
    if type_i:  sql += " AND d.type_intervention=?"; params.append(type_i)
    sql += " ORDER BY d.created_at DESC"

    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/dossiers/kanban", methods=["GET"])
@token_required
def kanban():
    with get_db() as db:
        rows = db.execute("""
            SELECT d.*, c.nom as client_nom, v.matricule, v.marque, v.modele
            FROM dossiers d
            JOIN clients c  ON c.id=d.client_id
            JOIN vehicles v ON v.id=d.vehicle_id
            WHERE d.statut != 'archive'
            ORDER BY
              CASE d.urgence WHEN 'tres_urgent' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
              d.created_at ASC
        """).fetchall()
    result = {"en_attente":[], "en_cours":[], "termine":[], "livre":[]}
    for r in rows:
        s = r["statut"]
        if s in result: result[s].append(dict(r))
    return jsonify(result)

@app.route("/api/dossiers/<int:did>", methods=["GET"])
@token_required
def get_dossier(did):
    with get_db() as db:
        d = db.execute("""
            SELECT d.*, c.nom as client_nom, c.tel as client_tel,
                   c.email as client_email, c.adresse as client_adresse,
                   v.matricule, v.marque, v.modele, v.annee, v.vin,
                   v.couleur, v.carburant, v.transmission, v.id as vehicle_id
            FROM dossiers d
            JOIN clients c  ON c.id=d.client_id
            JOIN vehicles v ON v.id=d.vehicle_id
            WHERE d.id=?""", (did,)).fetchone()
        if not d: return jsonify({"error":"Introuvable"}), 404
        logs = db.execute(
            "SELECT * FROM dossier_logs WHERE dossier_id=? ORDER BY created_at DESC", (did,)
        ).fetchall()
        pannes = db.execute(
            "SELECT * FROM dossier_pannes WHERE dossier_id=? ORDER BY created_at ASC", (did,)
        ).fetchall()
    return jsonify({**dict(d), "logs": [dict(l) for l in logs],
                    "pannes": [dict(p) for p in pannes]})

@app.route("/api/dossiers", methods=["POST"])
@token_required
def create_dossier():
    d = request.get_json(silent=True) or {}
    if vld(d, ["vehicle_id","client_id"]):
        return jsonify({"error":"vehicle_id et client_id requis"}), 400
    now = _now()
    with get_db() as db:
        numero = _gen_numero(db)
        # Alerte km
        km_in = d.get("km_entree")
        alerte = None
        if km_in:
            row = db.execute("""
                SELECT km_prochain_entretien FROM dossiers
                WHERE vehicle_id=? AND km_prochain_entretien IS NOT NULL
                ORDER BY created_at DESC LIMIT 1""", (d["vehicle_id"],)).fetchone()
            if row and row[0] and int(km_in) >= int(row[0]):
                alerte = f"⚠️ Kilométrage d'alerte atteint ({row[0]} km prévu)"

        cur = db.execute("""
            INSERT INTO dossiers(
                numero, vehicle_id, client_id, technician,
                statut, type_intervention, urgence,
                date_entree, date_sortie_prevue, date_sortie_reelle,
                km_entree, km_prochain_entretien,
                panne_description, panne_resolution, pieces_changees,
                garantie_mois, observations,
                type_tarif, cout_pieces, cout_main_oeuvre, remise,
                created_at, updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (numero, d["vehicle_id"], d["client_id"],
             request.user["username"],
             d.get("statut","en_attente"),
             d.get("type_intervention","reparation"),
             d.get("urgence","normal"),
             d.get("date_entree", now[:10]),
             d.get("date_sortie_prevue",""),
             d.get("date_sortie_reelle",""),
             km_in, d.get("km_prochain_entretien"),
             d.get("panne_description",""),
             d.get("panne_resolution",""),
             d.get("pieces_changees",""),
             d.get("garantie_mois",0),
             d.get("observations",""),
             d.get("type_tarif","facture"),
             float(d.get("cout_pieces",0) or 0),
             float(d.get("cout_main_oeuvre",0) or 0),
             float(d.get("remise",0) or 0),
             now, now))
        new_id = cur.lastrowid
        log_action(db, new_id, request.user["username"], "CREATION", f"Dossier {numero} créé")
        db.commit()
    resp = {"success":True, "id":new_id, "numero":numero}
    if alerte: resp["alerte"] = alerte
    return jsonify(resp), 201

@app.route("/api/dossiers/<int:did>", methods=["PUT"])
@token_required
def update_dossier(did):
    d = request.get_json(silent=True) or {}
    now = _now()
    with get_db() as db:
        old = db.execute("SELECT * FROM dossiers WHERE id=?", (did,)).fetchone()
        if not old: return jsonify({"error":"Introuvable"}), 404
        db.execute("""
            UPDATE dossiers SET
                statut=?, type_intervention=?, urgence=?,
                date_entree=?, date_sortie_prevue=?, date_sortie_reelle=?,
                km_entree=?, km_prochain_entretien=?,
                panne_description=?, panne_resolution=?, pieces_changees=?,
                garantie_mois=?, observations=?,
                type_tarif=?, cout_pieces=?, cout_main_oeuvre=?, remise=?,
                updated_at=?
            WHERE id=?""",
            (d.get("statut", old["statut"]),
             d.get("type_intervention", old["type_intervention"]),
             d.get("urgence", old["urgence"]),
             d.get("date_entree", old["date_entree"]),
             d.get("date_sortie_prevue", old["date_sortie_prevue"] or ""),
             d.get("date_sortie_reelle", old["date_sortie_reelle"] or ""),
             d.get("km_entree", old["km_entree"]),
             d.get("km_prochain_entretien", old["km_prochain_entretien"]),
             d.get("panne_description", old["panne_description"] or ""),
             d.get("panne_resolution", old["panne_resolution"] or ""),
             d.get("pieces_changees", old["pieces_changees"] or ""),
             d.get("garantie_mois", old["garantie_mois"] or 0),
             d.get("observations", old["observations"] or ""),
             d.get("type_tarif", old["type_tarif"] or "facture"),
             float(d.get("cout_pieces", old["cout_pieces"]) or 0),
             float(d.get("cout_main_oeuvre", old["cout_main_oeuvre"]) or 0),
             float(d.get("remise", old["remise"]) or 0),
             now, did))
        # Log si changement statut
        if d.get("statut") and d["statut"] != old["statut"]:
            log_action(db, did, request.user["username"],
                       "STATUT", f"{old['statut']} → {d['statut']}")
        else:
            log_action(db, did, request.user["username"], "MODIFICATION", "Dossier mis à jour")
        db.commit()
    return jsonify({"success":True})

@app.route("/api/dossiers/<int:did>/statut", methods=["PATCH"])
@token_required
def patch_statut(did):
    d = request.get_json(silent=True) or {}
    statut = d.get("statut","")
    valid = ("en_attente","en_cours","termine","livre","archive")
    if statut not in valid:
        return jsonify({"error":"Statut invalide"}), 400
    with get_db() as db:
        old = db.execute("SELECT statut FROM dossiers WHERE id=?", (did,)).fetchone()
        if not old: return jsonify({"error":"Introuvable"}), 404
        db.execute("UPDATE dossiers SET statut=?, updated_at=? WHERE id=?",
                   (statut, _now(), did))
        log_action(db, did, request.user["username"],
                   "STATUT", f"{old['statut']} → {statut}")
        db.commit()
    return jsonify({"success":True})

@app.route("/api/dossiers/<int:did>", methods=["DELETE"])
@admin_only
def delete_dossier(did):
    with get_db() as db:
        db.execute("DELETE FROM dossier_logs WHERE dossier_id=?", (did,))
        db.execute("DELETE FROM dossiers WHERE id=?", (did,))
        db.commit()
    return jsonify({"success":True})

# ══════════════════════════════════════════════════════════════════════
# PANNES INDÉPENDANTES
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/dossiers/<int:did>/pannes", methods=["GET"])
@token_required
def list_pannes(did):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM dossier_pannes WHERE dossier_id=? ORDER BY created_at ASC", (did,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/dossiers/<int:did>/pannes", methods=["POST"])
@token_required
def add_panne(did):
    d = request.get_json(silent=True) or {}
    desc = d.get("description","").strip()
    if not desc:
        return jsonify({"error":"Description requise"}), 400
    now = _now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO dossier_pannes(dossier_id,description,regle,created_at,updated_at) VALUES(?,?,0,?,?)",
            (did, desc, now, now))
        log_action(db, did, request.user["username"], "PANNE_AJOUT", desc[:80])
        db.commit()
    return jsonify({"success":True, "id": cur.lastrowid}), 201

@app.route("/api/pannes/<int:pid>/toggle", methods=["PATCH"])
@token_required
def toggle_panne(pid):
    now = _now()
    with get_db() as db:
        row = db.execute("SELECT * FROM dossier_pannes WHERE id=?", (pid,)).fetchone()
        if not row: return jsonify({"error":"Introuvable"}), 404
        new_val = 0 if row["regle"] else 1
        db.execute("UPDATE dossier_pannes SET regle=?, updated_at=? WHERE id=?",
                   (new_val, now, pid))
        log_action(db, row["dossier_id"], request.user["username"],
                   "PANNE_STATUT", f"{'✅ Réglé' if new_val else '🔴 Non réglé'} — {row['description'][:60]}")
        db.commit()
    return jsonify({"success":True, "regle": new_val})

@app.route("/api/pannes/<int:pid>", methods=["DELETE"])
@token_required
def delete_panne(pid):
    with get_db() as db:
        row = db.execute("SELECT * FROM dossier_pannes WHERE id=?", (pid,)).fetchone()
        if not row: return jsonify({"error":"Introuvable"}), 404
        db.execute("DELETE FROM dossier_pannes WHERE id=?", (pid,))
        log_action(db, row["dossier_id"], request.user["username"],
                   "PANNE_SUPPR", row["description"][:60])
        db.commit()
    return jsonify({"success":True})

# ══════════════════════════════════════════════════════════════════════
# PORTAIL VISITEUR — accès public par plaque
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/public/vehicle/<matricule>", methods=["GET"])
def public_vehicle(matricule):
    """Route publique — client saisit sa plaque pour voir ses dossiers."""
    with get_db() as db:
        v = db.execute("""
            SELECT v.id, v.matricule, v.marque, v.modele, v.annee,
                   v.couleur, v.carburant, v.transmission,
                   c.nom as client_nom
            FROM vehicles v
            LEFT JOIN clients c ON c.id=v.client_id
            WHERE LOWER(v.matricule)=LOWER(?)
            LIMIT 1""", (matricule.strip(),)).fetchone()
        if not v:
            return jsonify({"found": False}), 404
        dossiers = db.execute("""
            SELECT d.id, d.numero, d.statut, d.type_intervention, d.urgence,
                   d.date_entree, d.date_sortie_prevue, d.date_sortie_reelle,
                   d.panne_description, d.panne_resolution, d.pieces_changees,
                   d.garantie_mois, d.observations, d.technician,
                   d.cout_pieces, d.cout_main_oeuvre, d.remise, d.type_tarif
            FROM dossiers d
            WHERE d.vehicle_id=?
            ORDER BY d.date_entree DESC""", (v["id"],)).fetchall()
        # Pannes pour chaque dossier
        result_dos = []
        for d in dossiers:
            pannes = db.execute(
                "SELECT id, description, regle FROM dossier_pannes WHERE dossier_id=? ORDER BY created_at ASC",
                (d["id"],)
            ).fetchall()
            result_dos.append({**dict(d), "pannes": [dict(p) for p in pannes]})
    return jsonify({"found": True, "vehicle": dict(v), "dossiers": result_dos})



@app.route("/api/stats", methods=["GET"])
@token_required
def stats():
    with get_db() as db:
        def cnt(w=""): return db.execute(f"SELECT COUNT(*) FROM dossiers{' WHERE '+w if w else ''}").fetchone()[0]
        ca = db.execute("SELECT SUM(cout_pieces+cout_main_oeuvre-remise) FROM dossiers WHERE statut='livre'").fetchone()[0] or 0
        ca_month = db.execute("""
            SELECT SUM(cout_pieces+cout_main_oeuvre-remise) FROM dossiers
            WHERE statut='livre' AND strftime('%Y-%m',date_entree)=strftime('%Y-%m','now')
        """).fetchone()[0] or 0
        nb_clients  = db.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
        nb_vehicles = db.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0]
        urgents = cnt("urgence='tres_urgent' AND statut NOT IN ('livre','archive')")
    return jsonify({
        "total":cnt(), "en_attente":cnt("statut='en_attente'"),
        "en_cours":cnt("statut='en_cours'"), "termine":cnt("statut='termine'"),
        "livre":cnt("statut='livre'"),
        "ca":round(ca,2), "ca_mois":round(ca_month,2),
        "nb_clients":nb_clients, "nb_vehicles":nb_vehicles,
        "urgents":urgents,
    })


# ══════════════════════════════════════════════════════════════════════
# PHOTOS
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/dossiers/<int:did>/photos", methods=["GET"])
@token_required
def get_photos(did):
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM dossier_photos WHERE dossier_id=? ORDER BY created_at ASC", (did,)
        ).fetchall()
    result = []
    for r in rows:
        path = os.path.join(PHOTOS_DIR, r["filename"])
        if os.path.exists(path):
            with open(path, "rb") as f:
                data = base64.b64encode(f.read()).decode()
            ext = r["filename"].rsplit(".",1)[-1].lower()
            mime = {"jpg":"image/jpeg","jpeg":"image/jpeg","png":"image/png","webp":"image/webp"}.get(ext,"image/jpeg")
            result.append({"id":r["id"],"caption":r["caption"],
                           "created_at":r["created_at"],
                           "src":f"data:{mime};base64,{data}"})
    return jsonify(result)

@app.route("/api/dossiers/<int:did>/photos", methods=["POST"])
@token_required
def add_photo(did):
    d = request.get_json(silent=True) or {}
    src = d.get("src","")
    caption = d.get("caption","")
    if not src: return jsonify({"error":"Image requise"}), 400
    # Parse data URI
    m = re.match(r"data:(image/\w+);base64,(.+)", src)
    if not m: return jsonify({"error":"Format invalide"}), 400
    mime, b64data = m.group(1), m.group(2)
    ext = mime.split("/")[1].replace("jpeg","jpg")
    filename = f"dos{did}_{_now().replace(' ','_').replace(':','-')}.{ext}"
    path = os.path.join(PHOTOS_DIR, filename)
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64data))
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO dossier_photos(dossier_id,filename,caption,created_at) VALUES(?,?,?,?)",
            (did, filename, caption, _now()))
        db.commit()
    return jsonify({"success":True, "id": cur.lastrowid}), 201

@app.route("/api/photos/<int:pid>", methods=["DELETE"])
@token_required
def delete_photo(pid):
    with get_db() as db:
        row = db.execute("SELECT filename FROM dossier_photos WHERE id=?", (pid,)).fetchone()
        if not row: return jsonify({"error":"Introuvable"}), 404
        path = os.path.join(PHOTOS_DIR, row["filename"])
        if os.path.exists(path): os.remove(path)
        db.execute("DELETE FROM dossier_photos WHERE id=?", (pid,))
        db.commit()
    return jsonify({"success":True})

# ══════════════════════════════════════════════════════════════════════
# DELETE CLIENTS & VEHICLES (admin only)
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/clients/<int:cid>", methods=["DELETE"])
@admin_only
def delete_client(cid):
    with get_db() as db:
        # Vérifie s'il a des véhicules ou dossiers actifs
        nb_v = db.execute("SELECT COUNT(*) FROM vehicles WHERE client_id=?", (cid,)).fetchone()[0]
        nb_d = db.execute("SELECT COUNT(*) FROM dossiers WHERE client_id=? AND statut NOT IN ('termine','archive')", (cid,)).fetchone()[0]
        if nb_d > 0:
            return jsonify({"error":f"Ce client a {nb_d} dossier(s) actif(s). Terminez-les d'abord."}), 409
        # Supprime les dossiers archivés/terminés, puis véhicules, puis client
        dossier_ids = [r[0] for r in db.execute("SELECT id FROM dossiers WHERE client_id=?", (cid,)).fetchall()]
        for did in dossier_ids:
            db.execute("DELETE FROM dossier_logs WHERE dossier_id=?", (did,))
            db.execute("DELETE FROM dossier_photos WHERE dossier_id=?", (did,))
        db.execute("DELETE FROM dossiers WHERE client_id=?", (cid,))
        db.execute("DELETE FROM vehicles WHERE client_id=?", (cid,))
        db.execute("DELETE FROM clients WHERE id=?", (cid,))
        db.commit()
    return jsonify({"success":True})

@app.route("/api/vehicles/<int:vid>", methods=["DELETE"])
@admin_only
def delete_vehicle(vid):
    with get_db() as db:
        nb_d = db.execute(
            "SELECT COUNT(*) FROM dossiers WHERE vehicle_id=? AND statut NOT IN ('termine','archive')",
            (vid,)).fetchone()[0]
        if nb_d > 0:
            return jsonify({"error":f"Ce véhicule a {nb_d} dossier(s) actif(s). Terminez-les d'abord."}), 409
        dossier_ids = [r[0] for r in db.execute("SELECT id FROM dossiers WHERE vehicle_id=?", (vid,)).fetchall()]
        for did in dossier_ids:
            db.execute("DELETE FROM dossier_logs WHERE dossier_id=?", (did,))
            db.execute("DELETE FROM dossier_photos WHERE dossier_id=?", (did,))
        db.execute("DELETE FROM dossiers WHERE vehicle_id=?", (vid,))
        db.execute("DELETE FROM vehicles WHERE id=?", (vid,))
        db.commit()
    return jsonify({"success":True})

# ══════════════════════════════════════════════════════════════════════
# HEALTH / ANTI-SLEEP
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/ping", methods=["GET"])
def ping():
    """Endpoint léger pour anti-sleep Render + health check."""
    return jsonify({
        "status": "ok",
        "timestamp": _now(),
        "service": "Zenitsu Garage"
    })

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    print(f"Zenitsu Garage — http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)

# Gunicorn entry point (Render)
init_db()
