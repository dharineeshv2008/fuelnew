/**
 * FuelWise Shared Map Service
 * Houses lazy-loading mechanics, shared asset lookups, coordinate translation database,
 * boundary envelopes, POI generators, and UI marker handlers.
 */

const MAP_RESOURCES = {
    leafletCss: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    leafletJs: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
};

// Global data caches
window.allDistricts = [];
window.allConstituencies = [];
window.rawPlaces = [];
window.combinedPlaces = [];
window.locationCoords = {}; // Lat/Lng lookup map by name: name -> [lat, lng]

/**
 * Promisified CSS loader.
 */
function loadCSS(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`link[href="${url}"]`)) {
            resolve();
            return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
    });
}

/**
 * Promisified JS loader.
 */
function loadJS(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
}

/**
 * Lazy loads all map resources dynamically (CSS and JS libraries).
 */
window.lazyLoadMapResources = async function() {
    await loadCSS(MAP_RESOURCES.leafletCss);
    await loadJS(MAP_RESOURCES.leafletJs);
};

/**
 * Shared coordinates lookup maps for Tamil Nadu major cities.
 */
window.majorCitiesCoords = {
    "Chennai": [13.0827, 80.2707], "Tambaram": [12.9229, 80.1274], "Pallavaram": [12.9675, 80.1491],
    "Alandur": [13.0012, 80.2014], "Chengalpattu": [12.6921, 79.9757], "Kancheepuram": [12.8342, 79.7036],
    "Kanchipuram": [12.8342, 79.7036], "Arakkonam": [13.0790, 79.6677], "Vellore": [12.9165, 79.1325],
    "Gudiyatham": [12.9463, 78.8682], "Krishnagiri": [12.5266, 78.2148], "Hosur": [12.7409, 77.8253],
    "Dharmapuri": [12.1272, 78.1582], "Salem": [11.6643, 78.1460], "Mettur": [11.7862, 77.8010],
    "Namakkal": [11.2189, 78.1674], "Rasipuram": [11.4144, 78.1638], "Erode": [11.3410, 77.7172],
    "Gobichettipalayam": [11.4530, 77.4359], "Sathyamangalam": [11.5034, 77.2444], "Tiruppur": [11.1085, 77.3411],
    "Avinashi": [11.1931, 77.2687], "Coimbatore": [11.0168, 76.9558], "Pollachi": [10.6587, 77.0082],
    "Udumalpet": [10.5847, 77.2439], "Mettupalayam": [11.3006, 76.9405], "Ooty": [11.4102, 76.6950],
    "Coonoor": [11.3530, 76.7959], "Dindigul": [10.3624, 77.9695], "Palani": [10.4480, 77.5237],
    "Oddanchatram": [10.4795, 77.7471], "Madurai": [9.9252, 78.1198], "Melur": [9.9986, 78.3304],
    "Usilampatti": [9.9693, 77.7915], "Theni": [10.0104, 77.4770], "Bodinayakanur": [10.0104, 77.3496],
    "Bodinayakkanur": [10.0104, 77.3496], "Sivagangai": [9.8476, 78.4805], "Sivaganga": [9.8476, 78.4805],
    "Karaikudi": [10.0748, 78.7842], "Pudukkottai": [10.3797, 78.8207], "Thanjavur": [10.7870, 79.1378],
    "Kumbakonam": [10.9617, 79.3881], "Mayiladuthurai": [11.1035, 79.6508], "Nagapattinam": [10.7672, 79.8449],
    "Vedaranyam": [10.3752, 79.8454], "Mannargudi": [10.6628, 79.4449], "Tiruvarur": [10.7726, 79.6380],
    "Ariyalur": [11.1399, 79.0762], "Perambalur": [11.2329, 78.8814], "Tiruchirappalli": [10.7905, 78.7047],
    "Manapparai": [10.6074, 78.4168], "Ramanathapuram": [9.3739, 78.8308], "Paramakudi": [9.5447, 78.5910],
    "Rameswaram": [9.2885, 79.3129], "Virudhunagar": [9.5851, 77.9624], "Rajapalayam": [9.4532, 77.5606],
    "Sivakasi": [9.4532, 77.7915], "Aruppukkottai": [9.5164, 78.0988], "Arippukkottai": [9.5164, 78.0988],
    "Thoothukudi": [8.7642, 78.1348], "Kayalpattinam": [8.5714, 78.1189], "Kayalpatnam": [8.5714, 78.1189],
    "Tirunelveli": [8.7139, 77.7567], "Tenkasi": [8.9593, 77.3152], "Sankarankovil": [9.1722, 77.5342],
    "Ambasamudram": [8.7031, 77.4589], "Nagercoil": [8.1833, 77.4119], "Marthandam": [8.3039, 77.2208],
    "Colachel": [8.1764, 77.2559], "Kanyakumari": [8.0883, 77.5385]
};

window.tnEnvelopeCoords = [
    [13.45, 80.12], [13.08, 80.29], [12.62, 80.19], [11.75, 79.77],
    [11.15, 79.85], [10.77, 79.85], [10.28, 79.85], [9.28, 79.30],
    [8.76, 78.15], [8.30, 77.75], [8.08, 77.55], [8.18, 77.20],
    [8.96, 77.25], [9.70, 77.20], [10.30, 76.90], [11.41, 76.50],
    [11.65, 76.85], [11.55, 77.25], [12.15, 77.75], [12.75, 77.80],
    [12.55, 78.55], [12.95, 79.15], [13.15, 79.45], [13.45, 80.12]
];

window.boundaryLabels = [
    { text: "KERALA", coords: [10.2, 76.4] },
    { text: "KARNATAKA", coords: [12.6, 77.2] },
    { text: "ANDHRA PRADESH", coords: [13.6, 79.6] },
    { text: "PUDUCHERRY", coords: [11.93, 79.83] },
    { text: "SRI LANKA", coords: [8.7, 80.4] },
    { text: "BAY OF BENGAL", coords: [11.8, 80.9] },
    { text: "INDIAN OCEAN", coords: [7.8, 78.0] },
    { text: "PALK STRAIT", coords: [9.4, 79.2] },
    { text: "LACCADIVE SEA", coords: [8.1, 76.6] },
    { text: "Chennai Coast", coords: [13.08, 80.33] },
    { text: "Mahabalipuram Coast", coords: [12.62, 80.22] },
    { text: "Cuddalore Coast", coords: [11.75, 79.82] },
    { text: "Nagapattinam Coast", coords: [10.77, 79.89] },
    { text: "Vedaranyam Coast", coords: [10.38, 79.89] },
    { text: "Rameswaram Coast", coords: [9.28, 79.35] },
    { text: "Thoothukudi Coast", coords: [8.76, 78.18] },
    { text: "Kanyakumari Coast", coords: [8.08, 77.58] }
];

window.highwayData = {
    "National Highway 44": ["krishnagiri", "dharmapuri", "salem", "namakkal", "karur", "dindigul", "madurai", "virudhunagar", "tirunelveli", "kanyakumari"],
    "National Highway 45": ["chennai", "chengalpattu", "viluppuram", "perambalur", "tiruchirappalli", "dindigul", "theni"],
    "National Highway 48": ["chennai", "kanchipuram", "ranipet", "vellore", "tirupattur", "krishnagiri"],
    "East Coast Road (ECR)": ["chennai", "chengalpattu", "cuddalore", "mayiladuthurai", "nagapattinam", "tiruvarur", "pudukkottai", "ramanathapuram", "thoothukudi", "tirunelveli", "kanyakumari"]
};

/**
 * Creates custom pin SVGs.
 */
window.createCustomPin = function(color, letter = "") {
    const svgHtml = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 2A11 11 0 0 0 5 13c0 7.25 9.8 17.2 10.4 17.8a0.8 0.8 0 0 0 1.2 0c0.6-.6 10.4-10.55 10.4-17.8A11 11 0 0 0 16 2z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
            <circle cx="16" cy="13" r="4.5" fill="#ffffff"/>
            ${letter ? `<text x="16" y="24" font-size="9" font-weight="900" fill="#ffffff" text-anchor="middle">${letter}</text>` : ''}
        </svg>
    `;
    return L.divIcon({
        html: svgHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        className: 'custom-pin-marker'
    });
};

/**
 * Snaps coordinates to closest known town.
 */
window.findNearestLocation = function(latlng) {
    let nearestName = null;
    let nearestCoords = null;
    let minDistance = Infinity;
    
    for (let name in window.locationCoords) {
        const coords = window.locationCoords[name];
        const dist = L.latLng(coords[0], coords[1]).distanceTo(latlng);
        if (dist < minDistance) {
            minDistance = dist;
            nearestName = name;
            nearestCoords = coords;
        }
    }
    return { name: nearestName, coords: nearestCoords, distance: minDistance };
};

/**
 * Finds closest district HQ.
 */
window.findClosestDistrict = function(lat, lng) {
    let nearest = null;
    let minDist = Infinity;
    window.allDistricts.forEach(d => {
        const dist = L.latLng(d.lat, d.lng).distanceTo(L.latLng(lat, lng));
        if (dist < minDist) {
            minDist = dist;
            nearest = d;
        }
    });
    return nearest;
};

/**
 * Generates POIs for a district.
 */
window.generatePOIsForDistrict = function(district) {
    const lat = district.lat;
    const lng = district.lng;
    const name = district.name;
    const id = district.id;
    
    const pois = [
        { id: `${id}_coll`, name: `${name} District Collector Office`, type: 'government', lat: lat + 0.003, lng: lng + 0.003, description: `Official seat of the District Collector and administrative staff` },
        { id: `${id}_bus`, name: `${name} Major Bus Stand`, type: 'bus_stand', lat: lat - 0.004, lng: lng + 0.002, description: `Primary public bus transit station connecting municipal routes` },
        { id: `${id}_rail`, name: `${name} Railway Station`, type: 'railway', lat: lat + 0.002, lng: lng - 0.004, description: `Key Southern Railway junction terminal serving ${name}` },
        { id: `${id}_gh`, name: `${name} Government Headquarters Hospital`, type: 'hospital', lat: lat - 0.003, lng: lng - 0.003, description: `Primary state-run multispecialty healthcare hospital` },
        { id: `${id}_temple`, name: `${name} Sri Arulmigu Temple`, type: 'temple', lat: lat + 0.005, lng: lng + 0.001, description: `Historic spiritual sanctuary and architectural temple` },
        { id: `${id}_univ`, name: `${name} Government University`, type: 'college', lat: lat - 0.001, lng: lng + 0.006, description: `Higher academic institutions and research institute campus` },
        { id: `${id}_ind`, name: `${name} Industrial Zone`, type: 'industrial', lat: lat - 0.005, lng: lng - 0.001, description: `SIDCO industrial estate and manufacturing cluster` },
        { id: `${id}_ground`, name: `${name} VOC Public Grounds`, type: 'meeting_ground', lat: lat + 0.001, lng: lng - 0.005, description: `Major political gathering and public assembly field` },
        { id: `${id}_market`, name: `${name} Central Market`, type: 'market', lat: lat - 0.002, lng: lng + 0.005, description: `Wholesale agricultural and daily retail consumer market` },
        { id: `${id}_panchayat`, name: `${name} Town Panchayat Office`, type: 'town_panchayat', lat: lat + 0.006, lng: lng - 0.002, description: `Local town administration headquarters` },
        { id: `${id}_muni`, name: `${name} Municipality Office`, type: 'municipality', lat: lat - 0.005, lng: lng + 0.005, description: `Municipal corporate council administration office` },
        { id: `${id}_village`, name: `${district.major_cities && district.major_cities[0] ? district.major_cities[0] : name} Village`, type: 'village', lat: lat + 0.007, lng: lng + 0.007, description: `Major rural development panchayat village` }
    ];
    
    const coastalDistricts = ['chennai', 'chengalpattu', 'cuddalore', 'mayiladuthurai', 'nagapattinam', 'tiruvarur', 'pudukkottai', 'ramanathapuram', 'thoothukudi', 'tirunelveli', 'kanyakumari', 'tiruvallur'];
    if (coastalDistricts.includes(id)) {
        pois.push({ id: `${id}_port`, name: `${name} Port Facility`, type: 'port', lat: lat + 0.008, lng: lng + 0.004, description: `Maritime commercial shipping harbor and fishing port` });
    }
    
    return pois;
};

/**
 * Computes hexagon coordinates for constituency overlay.
 */
window.getConstituencyHexagonCoords = function(lat, lng, r = 0.018) {
    const coords = [];
    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const dLat = r * Math.sin(angle);
        const dLng = r * Math.cos(angle) / Math.cos(lat * Math.PI / 180);
        coords.push([lat + dLat, lng + dLng]);
    }
    return coords;
};

/**
 * Shared loader that fetches JSON files.
 */
window.loadStaticGISData = async function() {
    const [dRes, cRes, pRes, distRes] = await Promise.all([
        fetch('/static/data/districts.json'),
        fetch('/static/data/constituencies.json'),
        fetch('/static/data/places.json'),
        fetch('/static/data/distances.json')
    ]);

    const dData = await dRes.json();
    const cData = await cRes.json();
    const pData = await pRes.json();
    const distData = await distRes.json();

    window.allDistricts = dData.districts || [];
    window.allConstituencies = cData.constituencies || [];
    window.rawPlaces = pData.places || [];

    // Register offline fallback matrix in routingProvider
    if (window.routingProvider) {
        window.routingProvider.setMatrix(distData.matrix || {});
    }

    // Set up locationCoords lookup
    window.allDistricts.forEach(d => {
        window.locationCoords[d.name] = [d.lat, d.lng];
        window.locationCoords[d.hq] = [d.lat, d.lng];
    });

    window.allConstituencies.forEach(c => {
        window.locationCoords[c.name] = [c.lat, c.lng];
    });

    for (let city in window.majorCitiesCoords) {
        window.locationCoords[city] = window.majorCitiesCoords[city];
    }

    window.combinedPlaces = [...window.rawPlaces];
    window.rawPlaces.forEach(p => {
        window.locationCoords[p.name] = [p.lat, p.lng];
    });

    return distData;
};
