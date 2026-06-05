import os
import uuid
import logging
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, render_template, request, session, redirect, url_for, flash, Response, jsonify

# Load environment variables first
load_dotenv()

from utils import (
    calculate_fuel, plan_trip, get_random_tip, format_currency, safe_float,
    load_data, optimize_route, calculate_route_plan, estimate_days, parse_ai_query, find_distance
)

logging.basicConfig(level=logging.INFO)

# Resolve absolute paths for Vercel serverless compatibility
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static")
)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-fuelwise-super-secret-key")


# --- ERROR HANDLERS ---

@app.errorhandler(404)
def not_found(e):
    return render_template("login.html"), 404

@app.errorhandler(500)
def internal_error(e):
    return "Internal Server Error", 500

# --- MIDDLEWARE & GLOBALS ---

@app.before_request
def auth_middleware():
    """Ensure user is logged in for protected routes."""
    # Allow public pages
    public_endpoints = ["login", "register", "static"]
    if not session.get("user") and request.endpoint not in public_endpoints and request.endpoint:
        return redirect(url_for("login"))

@app.context_processor
def inject_globals():
    """Global data for templates."""
    currency = session.get("currency", "₹")

    return {
        "theme": session.get("theme", "light"),
        "currency": currency,
        "format_currency": lambda x: format_currency(x, currency),
        "now": datetime.now(),
        "user": session.get("user"),
        "active_vehicle_id": session.get("active_vehicle_id"),
        "price_petrol": session.get("price_petrol", 100.0),
        "price_diesel": session.get("price_diesel", 90.0),
        "price_cng": session.get("price_cng", 85.0),
        "price_ev": session.get("price_ev", 8.0),
    }

# --- AUTH ROUTES (Session-based) ───────

@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user"):
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")

        if not email or not password:
            flash("Please enter both email and password.", "error")
            return render_template("login.html")

        # Demo Mode: Accept any credentials
        session["user"] = {
            "id": str(uuid.uuid4()),
            "email": email,
            "name": email.split("@")[0].title(),
            "access_token": "demo-token-" + uuid.uuid4().hex[:8]
        }
        session.modified = True
        flash(f"Welcome back, {session['user']['name']}! (Demo Mode)", "success")
        return redirect(url_for("dashboard"))

    return render_template("login.html")

@app.route("/register", methods=["GET", "POST"])
def register():
    if session.get("user"):
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")

        if not name or not email or not password:
            flash("All fields are required.", "error")
            return render_template("register.html")

        if len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
            return render_template("register.html")

        # Demo Mode: Accept any registration
        flash("Account created successfully! Please login. (Demo Mode)", "success")
        return redirect(url_for("login"))

    return render_template("register.html")

@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("login"))

# --- APP ROUTES (DEMO MODE — In-Memory Data) ---

# In-memory storage for demo session
def _get_demo_store():
    """Get per-session demo data store."""
    if "demo_vehicles" not in session:
        session["demo_vehicles"] = []
    if "demo_trips" not in session:
        session["demo_trips"] = []
    if "demo_fuel_logs" not in session:
        session["demo_fuel_logs"] = []
    return session

@app.route("/")
def dashboard():
    from collections import defaultdict
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    trips = store.get("demo_trips", [])
    fuel_logs = store.get("demo_fuel_logs", [])

    total_spent = sum(float(l.get("total_cost", 0)) for l in fuel_logs)
    total_dist = sum(float(t.get("distance", 0)) for t in trips)
    total_fuel = sum(float(l.get("litres", 0)) for l in fuel_logs)

    # --- REAL Monthly Spending (from actual fuel logs) ---
    monthly_spend = defaultdict(float)
    for log in fuel_logs:
        date_str = log.get("date", "")
        if date_str and len(date_str) >= 7:
            month_key = date_str[:7]  # YYYY-MM
            monthly_spend[month_key] += float(log.get("total_cost", 0))
    monthly_spend_data = sorted(monthly_spend.items())  # [(YYYY-MM, amount), ...]

    # --- REAL Fuel Mix (from actual vehicle fleet) ---
    fuel_type_counts = defaultdict(int)
    for v in vehicles:
        ft = v.get("fuel_type", "Petrol")
        fuel_type_counts[ft] += 1
    fuel_mix_data = dict(fuel_type_counts)
    total_vehicles = len(vehicles)

    # --- Recent Activity (real records) ---
    currency = session.get("currency", "₹")
    recent_activity = []
    for l in list(reversed(fuel_logs))[:3]:
        vid = l.get("vehicle_id")
        fuel_type = "Petrol"
        v_name = "Unknown Vehicle"
        if vid:
            for v in vehicles:
                if v["id"] == vid:
                    fuel_type = v.get("fuel_type", "Petrol")
                    v_name = v.get("vehicle_name", "Vehicle")
                    break
        unit = "kWh" if fuel_type == "EV" else "L"
        recent_activity.append({
            "date": l["date"],
            "text": f"Fueled {v_name} — {l['litres']}{unit}",
            "amount": format_currency(l["total_cost"], currency),
            "icon": "fa-gas-pump"
        })
    for t in list(reversed(trips))[:2]:
        vid = t.get("vehicle_id")
        v_name = "Vehicle"
        if vid:
            for v in vehicles:
                if v["id"] == vid:
                    v_name = v.get("vehicle_name", "Vehicle")
                    break
        recent_activity.append({
            "date": t.get("created_at", datetime.now().isoformat()).split("T")[0],
            "text": f"Trip calc — {round(t['distance'])} km via {v_name}",
            "amount": format_currency(t["total_cost"], currency),
            "icon": "fa-calculator"
        })
    recent_activity = recent_activity[:5]

    log_count = len(fuel_logs)
    if log_count == 0:
        insight = "No fuel logs yet. Add your first refuel to start tracking."
    elif log_count == 1:
        insight = "1 fuel log recorded. Keep tracking to unlock spending trends."
    else:
        insight = f"{log_count} fuel logs recorded. Your spending data is building up."

    return render_template(
        "index.html",
        total_spent=total_spent,
        total_distance=total_dist,
        total_fuel=total_fuel,
        vehicle_count=total_vehicles,
        recent_activity=recent_activity,
        tip=get_random_tip(),
        insight=insight,
        monthly_spend_data=monthly_spend_data,
        fuel_mix_data=fuel_mix_data,
        total_vehicles=total_vehicles,
        has_data=(len(fuel_logs) > 0 or len(trips) > 0)
    )

@app.route("/calculator", methods=["GET", "POST"])
def calculator():
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    result = None
    form_data = request.form.to_dict() if request.method == "POST" else {}

    if request.method == "POST":
        action = request.form.get("action", "calculate")
        try:
            if action == "save_calc":
                trip = {
                    "id": uuid.uuid4().hex[:12],
                    "distance": safe_float(request.form.get("distance_val")),
                    "total_cost": safe_float(request.form.get("total_cost_val")),
                    "fuel_price": safe_float(request.form.get("price_val")),
                    "vehicle_id": request.form.get("vehicle_id_val") or None,
                    "trip_type": request.form.get("trip_type_val", "one-way"),
                    "passengers": int(safe_float(request.form.get("passengers_val", 1))),
                    "created_at": datetime.now().isoformat()
                }
                session["demo_trips"] = session.get("demo_trips", []) + [trip]
                session.modified = True
                flash("Trip saved to history! (Demo Mode)", "success")
                return redirect(url_for("calculator"))

            dist = safe_float(request.form.get("distance"))
            mileage = safe_float(request.form.get("mileage"))
            price = safe_float(request.form.get("fuel_price"))

            vehicle_id = request.form.get("vehicle_id")
            fuel_type = "Petrol"
            if vehicle_id:
                for v in vehicles:
                    if v["id"] == vehicle_id:
                        fuel_type = v.get("fuel_type", "Petrol")
                        if mileage <= 0: mileage = safe_float(v.get("mileage"))
                        break

            if action == "refresh":
                form_data["mileage"] = str(mileage) if mileage > 0 else ""
                return render_template("calculator.html", vehicles=vehicles, form=form_data)

            if dist <= 0 or mileage <= 0 or price <= 0:
                flash("Please provide positive values for Distance, Mileage, and Price.", "error")
            else:
                result = calculate_fuel(dist, mileage, price, request.form.get("trip_type", "one-way"), int(safe_float(request.form.get("passengers", 1))), safe_float(request.form.get("daily_km")), fuel_type)
                result["fuel_price"] = price
                if vehicle_id:
                    result["unit"] = "kWh" if fuel_type == "EV" else "Liters (L)"
                else:
                    result["unit"] = ""
                flash("Calculation complete!", "success")
        except Exception as e: flash(f"Calculator Error: {str(e)}", "error")

    return render_template("calculator.html", vehicles=vehicles, result=result, form=form_data)

@app.route("/vehicles", methods=["GET", "POST"])
def vehicles():
    store = _get_demo_store()
    if request.method == "POST":
        action = request.form.get("action")
        if action == "add":
            name = request.form.get("name", "").strip()
            mileage = safe_float(request.form.get("mileage"))
            tank = safe_float(request.form.get("tank_size"))
            if not name: flash("Vehicle name is required.", "error")
            elif mileage <= 0 or tank <= 0: flash("Mileage and Tank Size must be positive.", "error")
            else:
                vehicle = {
                    "id": uuid.uuid4().hex[:12],
                    "vehicle_name": name,
                    "vehicle_type": request.form.get("type", "car"),
                    "fuel_type": request.form.get("fuel_type", "Petrol"),
                    "mileage": mileage,
                    "tank_size": tank,
                    "year": request.form.get("year", "").strip()
                }
                session["demo_vehicles"] = session.get("demo_vehicles", []) + [vehicle]
                
                # Auto-set the first vehicle as active if none is active
                if not session.get("active_vehicle_id"):
                    session["active_vehicle_id"] = vehicle["id"]
                    
                session.modified = True
                flash(f"Vehicle '{name}' added! (Demo Mode)", "success")
                return redirect(url_for("vehicles"))
        elif action == "delete":
            vid = request.form.get("vehicle_id")
            session["demo_vehicles"] = [v for v in session.get("demo_vehicles", []) if v["id"] != vid]
            if session.get("active_vehicle_id") == vid:
                session["active_vehicle_id"] = None
            session.modified = True
            flash("Vehicle removed.", "info")
            return redirect(url_for("vehicles"))
        elif action == "set_active":
            vid = request.form.get("vehicle_id")
            session["active_vehicle_id"] = vid
            session.modified = True
            flash("Active vehicle selected.", "success")
            return redirect(url_for("vehicles"))

    return render_template("vehicles.html", vehicles=store.get("demo_vehicles", []))

@app.route("/history", methods=["GET", "POST"])
def history():
    store = _get_demo_store()
    if request.method == "POST":
        action = request.form.get("action")
        if action == "add_log":
            log = {
                "id": uuid.uuid4().hex[:12],
                "date": request.form.get("date"),
                "litres": safe_float(request.form.get("litres")),
                "price": safe_float(request.form.get("price")),
                "total_cost": safe_float(request.form.get("litres")) * safe_float(request.form.get("price")),
                "odometer": safe_float(request.form.get("odometer")),
                "vehicle_id": request.form.get("vehicle") or None,
                "notes": request.form.get("notes", "")
            }
            session["demo_fuel_logs"] = session.get("demo_fuel_logs", []) + [log]
            session.modified = True
            flash("Fuel log saved! (Demo Mode)", "success")
        elif action == "delete_log":
            lid = request.form.get("log_id")
            session["demo_fuel_logs"] = [l for l in session.get("demo_fuel_logs", []) if l["id"] != lid]
            session.modified = True
            flash("Fuel log deleted.", "info")
        elif action == "delete_trip":
            tid = request.form.get("trip_id")
            session["demo_trips"] = [t for t in session.get("demo_trips", []) if t["id"] != tid]
            session.modified = True
            flash("Calculation removed from history.", "info")
        return redirect(url_for("history"))

    vehicles_list = store.get("demo_vehicles", [])
    trips = store.get("demo_trips", [])
    logs = store.get("demo_fuel_logs", [])
    vmap = {v["id"]: v for v in vehicles_list}
    return render_template("history.html", trips=trips, logs=logs, vehicles=vehicles_list, vmap=vmap)

@app.route("/trip")
def trip_planner():
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    return render_template("trip.html", vehicles=vehicles)

@app.route("/trip/view/<trip_id>")
def trip_details(trip_id):
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    return render_template("trip_details.html", trip_id=trip_id, vehicles=vehicles)

@app.route("/trip/export/<trip_id>")
def trip_export(trip_id):
    return render_template("trip_report.html", trip_id=trip_id)

@app.route("/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        if "name" in request.form:
            name = request.form.get("name", "").strip()
            if name:
                if "user" in session:
                    session["user"]["name"] = name
                    session.modified = True
                flash("Profile name updated!", "success")
            else:
                flash("Name cannot be empty.", "error")
        elif "price_petrol" in request.form:
            session["price_petrol"] = safe_float(request.form.get("price_petrol"), 100.0)
            session["price_diesel"] = safe_float(request.form.get("price_diesel"), 90.0)
            session["price_cng"] = safe_float(request.form.get("price_cng"), 85.0)
            session["price_ev"] = safe_float(request.form.get("price_ev"), 8.0)
            session.modified = True
            flash("Fuel preferences updated!", "success")
        else:
            session["currency"] = request.form.get("currency", "₹")
            session["theme"] = request.form.get("theme", "light")
            session.modified = True
            flash("Settings updated!", "success")
        return redirect(url_for("settings"))
    return render_template("settings.html")

@app.route("/planner", methods=["GET", "POST"])
def smart_planner():
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    dist_data = load_data('distances.json')
    matrix = dist_data.get('matrix', {})
    cities = sorted(dist_data.get('cities', []))
    result = None
    form_data = {}
    ai_message = ""
    if request.method == "POST":
        action = request.form.get("action", "calculate")
        if action == "ai_parse":
            text = request.form.get("ai_text", "")
            parsed = parse_ai_query(text, cities)

            # ── Debug logging ──────────────────────────────────────────────────
            logging.info("[SmartPlanner] AI Parse Input: %s", text)
            logging.info("[SmartPlanner] Origin:      %s", parsed.get('origin', 'NOT FOUND'))
            logging.info("[SmartPlanner] Destination: %s", parsed.get('destination', 'NOT FOUND'))
            logging.info("[SmartPlanner] Waypoints:   %s", parsed.get('waypoints', []))
            logging.info("[SmartPlanner] Route:       %s", parsed.get('debug', {}).get('route', ''))

            waypoints = parsed.get('waypoints', [])

            # Validate waypoints are known cities
            unknown_waypoints = [w for w in waypoints if w and w not in cities]
            if unknown_waypoints:
                ai_message = f"Unable to create route through specified waypoint: {', '.join(unknown_waypoints)}"
                form_data = {'origin': parsed.get('origin', ''),
                             'destination': parsed.get('destination', ''),
                             'stops': [w for w in waypoints if w in cities],
                             'ai_text': text}
            elif parsed.get('parsed'):
                route_str = ' → '.join(parsed.get('found', []))
                wpt_str = ', '.join(waypoints) if waypoints else 'None'
                ai_message = (
                    f"Detected route: {route_str} | "
                    f"Waypoints: {wpt_str}"
                )
                form_data = {'origin': parsed.get('origin', ''),
                             'destination': parsed.get('destination', ''),
                             'stops': waypoints,
                             'ai_text': text}
            else:
                ai_message = "Could not detect locations. Please try: 'from Salem to Erode via Namakkal'"
                form_data = {'ai_text': text}

        else:
            origin = request.form.get("origin", "").strip()
            destination = request.form.get("destination", "").strip()
            stops_raw = request.form.getlist("stops[]")
            stops = [s.strip() for s in stops_raw if s.strip()]
            optimize = request.form.get("optimize") == "on"
            try:
                mileage = float(request.form.get("mileage", 15))
            except:
                mileage = 15.0
            try:
                fuel_price = float(request.form.get("fuel_price", 100))
            except:
                fuel_price = 100.0
            fuel_type = request.form.get("fuel_type", "Petrol")
            vid = request.form.get("vehicle_id", "")
            if vid:
                for v in vehicles:
                    if v["id"] == vid:
                        mileage = float(v.get("mileage", mileage))
                        fuel_type = v.get("fuel_type", fuel_type)
                        break
            if origin and destination:
                all_stops = [origin] + stops + [destination]
                if optimize and len(all_stops) > 3:
                    all_stops = optimize_route(all_stops, matrix)
                result = calculate_route_plan(all_stops, matrix, mileage, fuel_price, fuel_type)
                if result:
                    result['optimized'] = optimize
                    result['fuel_type'] = fuel_type
            form_data = {'origin': origin, 'destination': destination, 'stops': stops,
                         'mileage': mileage, 'fuel_price': fuel_price,
                         'vehicle_id': vid, 'fuel_type': fuel_type,
                         'optimize': optimize}
    return render_template("planner.html", vehicles=vehicles, result=result,
                           form=form_data, cities=cities, ai_message=ai_message)


@app.route("/campaign", methods=["GET", "POST"])
def campaign_planner():
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    const_data = load_data('constituencies.json')
    dist_data = load_data('districts.json')
    distance_data = load_data('distances.json')
    constituencies = const_data.get('constituencies', [])
    districts = dist_data.get('districts', [])
    matrix = distance_data.get('matrix', {})
    result = None
    active_tab = request.form.get("tab", request.args.get("tab", "constituency"))
    if request.method == "POST":
        tab = request.form.get("tab", "constituency")
        active_tab = tab
        try:
            mileage = float(request.form.get("mileage", 15))
        except:
            mileage = 15.0
        try:
            fuel_price = float(request.form.get("fuel_price", 100))
        except:
            fuel_price = session.get("price_petrol", 100.0)
        currency = session.get("currency", "\u20b9")
        if tab == "constituency":
            selected_ids = request.form.getlist("constituency_ids[]")
            selected = [c for c in constituencies if str(c['id']) in selected_ids]
            if not selected:
                flash("Please select at least 2 constituencies.", "warning")
            else:
                seen_districts = list(dict.fromkeys([c['district'] for c in selected]))
                waypoints = seen_districts
                if len(waypoints) > 2:
                    waypoints = optimize_route(waypoints, matrix)
                total_km = 0
                for i in range(len(waypoints)-1):
                    d = find_distance(waypoints[i], waypoints[i+1], matrix)
                    total_km += d if d else 60
                fuel_needed = total_km / max(mileage, 1)
                total_cost = fuel_needed * fuel_price
                days = estimate_days(total_km)
                result = {'type': 'constituency', 'selected_count': len(selected),
                          'route': waypoints, 'total_km': round(total_km,1),
                          'fuel_needed': round(fuel_needed,2),
                          'total_cost': round(total_cost,2), 'days': days,
                          'constituencies': selected, 'currency': currency}
        elif tab == "district":
            selected_district_ids = request.form.getlist("district_ids[]")
            selected_districts = [d for d in districts if d['id'] in selected_district_ids]
            if len(selected_districts) < 2:
                flash("Please select at least 2 districts.", "warning")
            else:
                waypoints = [d['hq'] for d in selected_districts]
                if len(waypoints) > 2:
                    waypoints = optimize_route(waypoints, matrix)
                total_km = 0
                for i in range(len(waypoints)-1):
                    d = find_distance(waypoints[i], waypoints[i+1], matrix)
                    total_km += d if d else 80
                fuel_needed = total_km / max(mileage, 1)
                total_cost = fuel_needed * fuel_price
                days = estimate_days(total_km)
                result = {'type': 'district', 'selected_count': len(selected_districts),
                          'route': waypoints, 'total_km': round(total_km,1),
                          'fuel_needed': round(fuel_needed,2),
                          'total_cost': round(total_cost,2), 'days': days,
                          'districts': selected_districts, 'currency': currency}
    return render_template("campaign.html", vehicles=vehicles, constituencies=constituencies,
                           districts=districts, result=result, active_tab=active_tab)


@app.route("/compare")
def vehicle_compare():
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    vid_a = request.args.get("a", "")
    vid_b = request.args.get("b", "")
    v_a = next((v for v in vehicles if v["id"] == vid_a), None)
    v_b = next((v for v in vehicles if v["id"] == vid_b), None)
    comparison = None
    if v_a and v_b:
        monthly_km = 1000
        price_map = {
            'petrol': float(session.get('price_petrol', 102.0)),
            'diesel': float(session.get('price_diesel', 89.0)),
            'cng': float(session.get('price_cng', 75.0)),
            'ev': float(session.get('price_ev', 8.0)),
        }
        def fuel_cost_per_km(v):
            ft = v.get('fuel_type', 'Petrol').lower()
            price = price_map.get(ft, 100.0)
            mil = max(float(v.get('mileage', 15)), 1.0)
            return price / mil
        def monthly_cost(v):
            return fuel_cost_per_km(v) * monthly_km
        def co2_per_100km(v):
            factors = {'Petrol': 2.31, 'Diesel': 2.68, 'CNG': 2.0, 'EV': 0.0, 'Hybrid': 1.5}
            ft = v.get('fuel_type', 'Petrol')
            mil = max(float(v.get('mileage', 15)), 1.0)
            liters_per_100km = 100.0 / mil
            return liters_per_100km * factors.get(ft, 2.31)
        mc_a = monthly_cost(v_a)
        mc_b = monthly_cost(v_b)
        co2_a = co2_per_100km(v_a)
        co2_b = co2_per_100km(v_b)
        cpkm_a = fuel_cost_per_km(v_a)
        cpkm_b = fuel_cost_per_km(v_b)
        comparison = {
            'v_a': v_a, 'v_b': v_b,
            'monthly_cost_a': round(mc_a, 2), 'monthly_cost_b': round(mc_b, 2),
            'yearly_cost_a': round(mc_a * 12, 2), 'yearly_cost_b': round(mc_b * 12, 2),
            'co2_a': round(co2_a, 2), 'co2_b': round(co2_b, 2),
            'cpkm_a': round(cpkm_a, 2), 'cpkm_b': round(cpkm_b, 2),
            'savings_monthly': round(abs(mc_a - mc_b), 2),
            'savings_yearly': round(abs(mc_a - mc_b) * 12, 2),
            'better_cost': v_a['vehicle_name'] if mc_a <= mc_b else v_b['vehicle_name'],
            'better_eco': v_a['vehicle_name'] if co2_a <= co2_b else v_b['vehicle_name'],
        }
    return render_template("compare.html", vehicles=vehicles, comparison=comparison, vid_a=vid_a, vid_b=vid_b)


@app.route("/maintenance", methods=["GET", "POST"])
def maintenance():
    store = _get_demo_store()
    vehicles = store.get("demo_vehicles", [])
    if "maintenance_logs" not in session:
        session["maintenance_logs"] = []
    if request.method == "POST":
        action = request.form.get("action", "add")
        if action == "add":
            import uuid as _uuid
            log = {
                "id": _uuid.uuid4().hex[:12],
                "vehicle_id": request.form.get("vehicle_id", ""),
                "type": request.form.get("maintenance_type", "Service"),
                "last_date": request.form.get("last_date", ""),
                "next_date": request.form.get("next_date", ""),
                "odometer": request.form.get("odometer", ""),
                "notes": request.form.get("notes", ""),
                "created_at": datetime.now().isoformat()
            }
            logs = list(session.get("maintenance_logs", []))
            logs.append(log)
            session["maintenance_logs"] = logs
            session.modified = True
            flash("Maintenance record added successfully.", "success")
        elif action == "delete":
            mid = request.form.get("maintenance_id", "")
            session["maintenance_logs"] = [l for l in session.get("maintenance_logs", []) if l.get("id") != mid]
            session.modified = True
            flash("Record removed.", "info")
        return redirect(url_for("maintenance"))
    logs = session.get("maintenance_logs", [])
    vmap = {v["id"]: v for v in vehicles}
    today = datetime.now().date()
    processed_logs = []
    for log in logs:
        log = dict(log)
        if log.get("next_date"):
            try:
                nd = datetime.strptime(log["next_date"], "%Y-%m-%d").date()
                days_remaining = (nd - today).days
                log["days_remaining"] = days_remaining
                log["status"] = "overdue" if days_remaining < 0 else ("due_soon" if days_remaining <= 30 else "ok")
            except:
                log["days_remaining"] = None
                log["status"] = "unknown"
        else:
            log["days_remaining"] = None
            log["status"] = "unknown"
        processed_logs.append(log)
    return render_template("maintenance.html", vehicles=vehicles, maintenance_logs=processed_logs, vmap=vmap)


@app.route("/api/locations")
def api_locations():
    query = request.args.get("q", "").strip().lower()
    dist_data = load_data('distances.json')
    cities = dist_data.get('cities', [])
    if query:
        matched = [c for c in cities if query in c.lower()]
    else:
        matched = cities[:30]
    return jsonify({"locations": matched[:25]})


@app.route("/api/distance")
def api_distance():
    origin = request.args.get("from", "").strip()
    dest = request.args.get("to", "").strip()
    dist_data = load_data('distances.json')
    matrix = dist_data.get('matrix', {})
    distance = find_distance(origin, dest, matrix)
    return jsonify({"distance": distance, "from": origin, "to": dest})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
