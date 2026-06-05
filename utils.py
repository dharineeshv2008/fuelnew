import random
import os
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

# --- UTILITIES ---

def safe_float(value, default=0.0):
    try:
        if value is None or str(value).strip() == "":
            return default
        return float(value)
    except (ValueError, TypeError):
        return default

# --- CORE CALCULATIONS ---

def get_efficiency_rating(mileage, fuel_type="Petrol"):
    if fuel_type == "EV":
        if mileage >= 7: return "Super Efficient 🍃"
        if mileage >= 5: return "Great Efficiency ✨"
        if mileage >= 3: return "Average Economy 🚗"
        return "Heavy Consumer 🔋"
    else:
        if mileage >= 25: return "Super Efficient 🍃"
        if mileage >= 18: return "Great Mileage ✨"
        if mileage >= 12: return "Average Economy 🚗"
        return "Heavy Consumer ⛽"

def calculate_fuel(distance, mileage, fuel_price, trip_type, passengers, daily_km, fuel_type="Petrol"):
    passengers = max(1, passengers)
    actual_distance = distance * 2 if trip_type == "round-trip" else distance
    fuel_needed = actual_distance / mileage
    total_cost = fuel_needed * fuel_price
    cost_per_km = total_cost / actual_distance
    cost_per_passenger = total_cost / passengers

    co2_factors = {"Petrol": 2.31, "Diesel": 2.68, "CNG": 2.0, "EV": 0.0}
    co2_emissions = fuel_needed * co2_factors.get(fuel_type, 2.31)
    consumption = (fuel_needed / actual_distance) * 100

    wear_tear = actual_distance * 0.15
    total_trip_impact = total_cost + wear_tear

    savings_potential = 0
    if mileage < 20:
        optimal_fuel = actual_distance / 20
        savings_potential = (fuel_needed - optimal_fuel) * fuel_price

    monthly_cost = (daily_km * 30 / mileage) * fuel_price if daily_km > 0 else 0
    yearly_cost = (daily_km * 365 / mileage) * fuel_price if daily_km > 0 else 0

    return {
        "distance": actual_distance, "fuel_needed": fuel_needed, "total_cost": total_cost,
        "cost_per_km": cost_per_km, "cost_per_passenger": cost_per_passenger,
        "rating": get_efficiency_rating(mileage, fuel_type), "co2": co2_emissions,
        "consumption": consumption, "monthly_cost": monthly_cost, "yearly_cost": yearly_cost,
        "wear_tear": wear_tear, "total_impact": total_trip_impact, "savings_potential": savings_potential
    }

def plan_trip(total_dist, mileage, fuel_price, tank_size, speed):
    tank_size = max(1, tank_size)
    speed = max(1, speed)
    total_fuel = total_dist / mileage
    total_cost = total_fuel * fuel_price
    travel_time = total_dist / speed
    range_per_tank = tank_size * mileage
    num_stops = max(0, int((total_dist - 0.1) // range_per_tank))

    stops = []
    for i in range(1, num_stops + 1):
        stop_km = min(range_per_tank * i, total_dist)
        stops.append({"num": i, "km": round(stop_km, 1), "litres": round(tank_size, 1), "cost": round(tank_size * fuel_price, 2)})

    return {"total_dist": total_dist, "total_fuel": total_fuel, "total_cost": total_cost, "travel_time": travel_time, "range": range_per_tank, "num_stops": num_stops, "stops": stops}

def get_random_tip():
    tips = ["Maintain steady speeds.", "Keep tires properly inflated.", "Avoid carrying unnecessary weight.", "Use cruise control on highways.", "Plan trips during off-peak hours.", "Service your engine regularly.", "Avoid excessive idling.", "Use recommended motor oil.", "Close windows at highway speeds.", "Combine multiple errands.", "Shift to higher gears smoothly.", "Air conditioning can increase consumption.", "Park in the shade.", "Slow down.", "Remove roof racks when not in use."]
    return random.choice(tips)

def format_currency(amount, symbol):
    return f"{symbol}{float(amount or 0):,.2f}"


# --- DATA & ROUTE UTILITIES ---

import json

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'data')

def load_data(filename):
    """Load a JSON data file from static/data/"""
    try:
        filepath = os.path.join(_DATA_DIR, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def find_distance(origin, dest, matrix):
    """Find road distance between two cities from lookup matrix"""
    if not origin or not dest or origin == dest:
        return 0
    d = matrix.get(origin, {}).get(dest)
    if d is None:
        d = matrix.get(dest, {}).get(origin)
    return d if d is not None else None

def optimize_route(stops, matrix):
    """
    Highly optimized TSP solver to minimize travel distance.
    Uses exact search for small stop counts (<= 8) and multi-start 2-opt for larger counts.
    """
    # Remove duplicates
    unique_stops = []
    for s in stops:
        if s not in unique_stops:
            unique_stops.append(s)
            
    if len(unique_stops) <= 2:
        return unique_stops

    def get_dist(a, b):
        if a == b:
            return 0
        d = matrix.get(a, {}).get(b) or matrix.get(b, {}).get(a)
        return d if d is not None else 100.0  # default fallback distance

    def route_distance(route):
        return sum(get_dist(route[i], route[i+1]) for i in range(len(route)-1))

    # Exact search for small counts (<= 8 stops)
    if len(unique_stops) <= 8:
        import itertools
        best_route = unique_stops
        min_dist = float('inf')
        # We can fix the first stop to reduce search space to (N-1)!
        first = unique_stops[0]
        rest = unique_stops[1:]
        for perm in itertools.permutations(rest):
            current_route = [first] + list(perm)
            d = route_distance(current_route)
            if d < min_dist:
                min_dist = d
                best_route = current_route
        return best_route

    # Multi-start 2-opt heuristic for larger counts
    best_overall_route = unique_stops
    min_overall_dist = float('inf')

    # Try 5 different starting routes (original plus random shuffles)
    starts = [unique_stops]
    import random
    random.seed(42)  # for deterministic behavior
    for _ in range(4):
        shuffled = unique_stops[:]
        random.shuffle(shuffled)
        starts.append(shuffled)

    for start_route in starts:
        route = start_route[:]
        improved = True
        while improved:
            improved = False
            for i in range(1, len(route) - 2):
                for j in range(i + 1, len(route)):
                    if j - i == 1: continue
                    new_route = route[:]
                    new_route[i:j] = route[j-1:i-1:-1] # reverse the segment
                    if route_distance(new_route) < route_distance(route):
                        route = new_route
                        improved = True
        
        d = route_distance(route)
        if d < min_overall_dist:
            min_overall_dist = d
            best_overall_route = route

    return best_overall_route

def calculate_route_plan(stops, matrix, mileage, fuel_price, fuel_type='Petrol'):
    """Calculate full route plan statistics from list of stops"""
    if len(stops) < 2:
        return None
    mileage = max(float(mileage), 1.0)
    fuel_price = max(float(fuel_price), 1.0)
    segments = []
    total_km = 0
    for i in range(len(stops) - 1):
        dist = find_distance(stops[i], stops[i+1], matrix)
        if dist is None:
            dist = 80  # fallback average
        segments.append({'from': stops[i], 'to': stops[i+1], 'distance': dist})
        total_km += dist
    fuel_needed = total_km / mileage
    total_cost = fuel_needed * fuel_price
    travel_hours = total_km / 60.0
    co2_factors = {'Petrol': 2.31, 'Diesel': 2.68, 'CNG': 2.0, 'EV': 0.0, 'Hybrid': 1.5}
    co2 = fuel_needed * co2_factors.get(fuel_type, 2.31)
    return {
        'stops': stops,
        'segments': segments,
        'total_km': round(total_km, 1),
        'fuel_needed': round(fuel_needed, 2),
        'total_cost': round(total_cost, 2),
        'travel_hours': round(travel_hours, 1),
        'co2': round(co2, 2),
        'stop_count': len(stops) - 2
    }

def estimate_days(total_km, daily_km=300):
    """Estimate travel days for a route"""
    if total_km <= 0:
        return 1
    return max(1, round((total_km / daily_km) + 0.4))

def parse_ai_query(text, cities):
    """
    Parse natural language trip request and extract origin, destination, and waypoints.

    Supports:
      - "Karur to Namakkal via Mohanur"
      - "from Karur to Salem via Namakkal via Rasipuram"
      - "Karur to Salem through Namakkal"
      - "Madurai to Chennai passing through Trichy"
      - "Chennai to Coimbatore stop at Salem"
    """
    import re
    import logging

    logger = logging.getLogger(__name__)
    logger.debug("[parse_ai_query] Input text: %s", text)

    text_norm = ' '.join(text.strip().split())  # normalise whitespace

    # ── Step 1: Tokenise on waypoint keywords (case-insensitive) ──────────────
    # Normalise all waypoint/connector phrases to a canonical token
    NORMALIZE = [
        (r'(?i)\bpassing\s+through\b', '__VIA__'),
        (r'(?i)\bstop\s+at\b',         '__VIA__'),
        (r'(?i)\bthrough\b',           '__VIA__'),
        (r'(?i)\bvia\b',               '__VIA__'),
        (r'(?i)\bfrom\b',              '__FROM__'),
        (r'(?i)\bto\b',                '__TO__'),
    ]

    normalised = text_norm
    for pattern, replacement in NORMALIZE:
        normalised = re.sub(pattern, replacement, normalised)

    logger.debug("[parse_ai_query] Normalised text: %s", normalised)

    # Split on canonical tokens (kept as delimiters)
    parts = re.split(r'(__FROM__|__TO__|__VIA__)', normalised)

    # ── Step 2: Walk the token list building role → text segments ─────────────
    origin_texts    = []
    dest_texts      = []
    waypoint_texts  = []

    current_role = 'origin'   # default: text before __TO__
    i = 0
    while i < len(parts):
        token = parts[i].strip()

        if token == '__FROM__':
            current_role = 'origin'
            i += 1
            continue
        elif token == '__TO__':
            current_role = 'destination'
            i += 1
            continue
        elif token == '__VIA__':
            current_role = 'waypoint'
            i += 1
            continue
        else:
            # It's a text segment — assign to current role
            seg = token
            if seg:
                if current_role == 'origin':
                    origin_texts.append(seg)
                elif current_role == 'destination':
                    dest_texts.append(seg)
                elif current_role == 'waypoint':
                    waypoint_texts.append(seg)
        i += 1


    logger.debug("[parse_ai_query] origin_texts=%s dest_texts=%s waypoint_texts=%s",
                 origin_texts, dest_texts, waypoint_texts)

    # ── Step 3: Match each text segment to known cities ───────────────────────
    sorted_cities = sorted(cities, key=len, reverse=True)

    def find_city_in_text(seg):
        """Return the best matching city name found inside a text segment."""
        seg_lower = seg.lower()
        for city in sorted_cities:
            if city.lower() in seg_lower:
                return city
        return None

    origin      = find_city_in_text(' '.join(origin_texts))   if origin_texts      else None
    destination = find_city_in_text(' '.join(dest_texts))     if dest_texts        else None
    waypoints   = []
    for wt in waypoint_texts:
        city = find_city_in_text(wt)
        if city and city not in waypoints:
            waypoints.append(city)

    logger.debug("[parse_ai_query] Matched → origin=%s destination=%s waypoints=%s",
                 origin, destination, waypoints)

    # ── Step 4: Fallback — if structured parsing failed, use the old scan ──────
    if not origin or not destination:
        logger.warning("[parse_ai_query] Structured parse failed, falling back to scan.")
        found_fallback = []
        text_lower = text.lower()
        for city in sorted_cities:
            if city.lower() in text_lower and city not in found_fallback:
                found_fallback.append(city)
        if len(found_fallback) >= 2:
            origin      = found_fallback[0]
            destination = found_fallback[-1]
            waypoints   = found_fallback[1:-1]
            logger.debug("[parse_ai_query] Fallback result → origin=%s destination=%s waypoints=%s",
                         origin, destination, waypoints)
        else:
            logger.warning("[parse_ai_query] Could not detect locations from: %s", text)
            return {'parsed': False, 'found': found_fallback, 'waypoints': [], 'debug': {}}

    # Remove waypoints that are the same as origin/destination
    waypoints = [w for w in waypoints if w and w != origin and w != destination]

    all_found = [origin] + waypoints + [destination]

    debug_info = {
        'origin': origin,
        'destination': destination,
        'waypoints': waypoints,
        'route': ' → '.join(all_found),
    }
    logger.info("[parse_ai_query] Result → %s", debug_info)

    return {
        'origin':      origin,
        'destination': destination,
        'waypoints':   waypoints,
        'stops':       waypoints,   # backward-compat alias
        'parsed':      True,
        'found':       all_found,
        'debug':       debug_info,
    }
