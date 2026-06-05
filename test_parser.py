"""Quick test script for the improved parse_ai_query NLP parser."""
import logging
logging.basicConfig(level=logging.WARNING)

from utils import parse_ai_query, load_data

d = load_data('distances.json')
cities = d.get('cities', [])

tests = [
    "Karur to Namakkal",
    "Karur to Salem via Namakkal",
    "from Karur to Salem via Namakkal via Erode",
    "Madurai to Chennai passing through Tiruchirappalli",
    "Chennai to Coimbatore stop at Salem",
    "Karur to Salem through Namakkal",
    "from Madurai to Erode stop at Dindigul",
    "karur to namakkal via mohanur",   # mohanur not in DB - waypoints empty
]

PASS = 0
FAIL = 0

expected = [
    ("Karur",   "Namakkal",         []),
    ("Karur",   "Salem",            ["Namakkal"]),
    ("Karur",   "Salem",            ["Namakkal", "Erode"]),
    ("Madurai", "Chennai",          ["Tiruchirappalli"]),
    ("Chennai", "Coimbatore",       ["Salem"]),
    ("Karur",   "Salem",            ["Namakkal"]),
    ("Madurai", "Erode",            ["Dindigul"]),
    ("Karur",   "Namakkal",         []),  # Mohanur not in DB → waypoints empty
]

for i, (text, (exp_o, exp_d, exp_w)) in enumerate(zip(tests, expected)):
    r = parse_ai_query(text, cities)
    origin    = r.get("origin", "")
    dest      = r.get("destination", "")
    waypoints = r.get("waypoints", [])
    ok = (origin == exp_o and dest == exp_d and waypoints == exp_w)
    status = "PASS" if ok else "FAIL"
    if ok: PASS += 1
    else:  FAIL += 1
    print(f"[{status}] Input: {text!r}")
    if not ok:
        print(f"       Expected: origin={exp_o!r}, dest={exp_d!r}, waypoints={exp_w}")
        print(f"       Got:      origin={origin!r}, dest={dest!r}, waypoints={waypoints}")
    else:
        print(f"       origin={origin!r}, dest={dest!r}, waypoints={waypoints}")
    print()

print(f"Results: {PASS} passed, {FAIL} failed out of {len(tests)} tests")
