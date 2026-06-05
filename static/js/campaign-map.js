/**
 * FuelWise Campaign Planner Mapping Controller v2.0
 * - Removed custom pin feature (broken/confusing)
 * - Upgraded district markers to labeled hexagonal divIcons
 * - Kongu Belt towns loaded from kongu_towns.json
 * - Waypoint routing with validation and error toasts
 * - Structured debug logging throughout
 * - Optimized map performance + auto-fit bounds
 */

// ─── Globals ─────────────────────────────────────────────────────────────────
let map = null;
let liveRouteGroup = null;
let serverRouteGroup = null;
let currentActiveDistrictId = null;

const districtMarkers   = {};
const districtBoundsCircles = {};
const constituencyMarkers   = {};
const constituencyPolygons  = {};
const districtGISGroups     = {};

const mapLayers = {
    highways: null,
    districts: null,
    constituencies: null,
    government: null,
    transport: null,
    hospitals: null,
    temples: null,
    konguTowns: null
};

// Kongu Belt towns (loaded from JSON)
let konguTowns = [];

// ─── Popup HTML ──────────────────────────────────────────────────────────────
function getCampaignPopupHtml(name, subtitle = '') {
    return `
        <div class="space-y-2">
            <div class="text-xs font-bold text-gray-100">${name}</div>
            ${subtitle ? `<div class="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">${subtitle}</div>` : ''}
            <div class="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
                <button type="button" onclick="toggleCampaignStop('${name}', true)"
                    class="px-2 py-1 bg-[#18a06a] hover:bg-[#0f7b53] text-[9px] font-bold uppercase text-white rounded transition-all">
                    Add Stop
                </button>
            </div>
        </div>
    `;
}

// ─── District HEX marker (DivIcon) ───────────────────────────────────────────
function createDistrictHexIcon(code, selected = false, partial = false) {
    const color   = selected ? '#F1C40F' : (partial ? '#E67E22' : '#18A06A');
    const bgColor = selected ? 'rgba(241,196,15,0.18)' : (partial ? 'rgba(230,126,34,0.15)' : 'rgba(24,160,106,0.12)');
    const border  = selected ? '#FFD700' : (partial ? '#F39C12' : '#18A06A');
    const textCol = selected ? '#FFD700' : (partial ? '#F39C12' : '#2ECC71');
    const glow    = selected ? `box-shadow: 0 0 10px 3px rgba(241,196,15,0.55);` : '';
    const html = `
        <div style="
            width:36px; height:36px;
            background:${bgColor};
            border:2px solid ${border};
            border-radius:6px;
            display:flex; align-items:center; justify-content:center;
            font-size:9px; font-weight:900;
            color:${textCol};
            font-family:inherit;
            letter-spacing:0.03em;
            ${glow}
            transition: all 0.2s;
            cursor:pointer;
        ">${code}</div>
    `;
    return L.divIcon({
        html,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
        className: ''
    });
}

// ─── Route stop pin (for rendered route) ─────────────────────────────────────
function createRoutePinIcon(color, label) {
    const html = `
        <div style="
            width:28px; height:28px;
            background:${color};
            border:2.5px solid #ffffff;
            border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            font-size:10px; font-weight:900; color:#fff;
            font-family:inherit;
            box-shadow:0 2px 8px rgba(0,0,0,0.5);
        ">${label}</div>
    `;
    return L.divIcon({
        html,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
        className: ''
    });
}

// ─── Coordinate lookup ────────────────────────────────────────────────────────
function getCampaignCoordinate(stopNameOrId) {
    if (!stopNameOrId) return null;
    const searchStr = String(stopNameOrId).toLowerCase().trim();

    if (searchStr.includes(',') && !isNaN(searchStr.split(',')[0])) {
        const parts = searchStr.split(',');
        return [parseFloat(parts[0]), parseFloat(parts[1])];
    }

    // Check Kongu Belt towns first (highest priority for waypoints)
    const konguMatch = konguTowns.find(t => t.name.toLowerCase() === searchStr);
    if (konguMatch) return [konguMatch.lat, konguMatch.lng];

    // Check districts
    const dById   = window.allDistricts.find(d => String(d.id).toLowerCase() === searchStr);
    if (dById)   return [dById.lat, dById.lng];
    const cById   = window.allConstituencies.find(c => String(c.id).toLowerCase() === searchStr);
    if (cById)   return [cById.lat, cById.lng];
    const dByName = window.allDistricts.find(d => d.name.toLowerCase() === searchStr || d.hq.toLowerCase() === searchStr);
    if (dByName) return [dByName.lat, dByName.lng];
    const cByName = window.allConstituencies.find(c => c.name.toLowerCase() === searchStr);
    if (cByName) return [cByName.lat, cByName.lng];

    // Check majorCitiesCoords
    if (window.majorCitiesCoords) {
        for (const city in window.majorCitiesCoords) {
            if (city.toLowerCase() === searchStr) return window.majorCitiesCoords[city];
        }
    }
    return null;
}

// ─── Stop toggle from popup ───────────────────────────────────────────────────
window.toggleCampaignStop = function(idOrName, add) {
    if (!idOrName) return;
    const isDistrictMode = (window.routeType === 'district' || document.getElementById('tabInput')?.value === 'district');
    const searchStr = String(idOrName).toLowerCase().trim();

    if (isDistrictMode) {
        let cb = document.querySelector(`.dist-check[value="${idOrName}"]`);
        if (!cb) cb = Array.from(document.querySelectorAll('.dist-check')).find(el => el.dataset.name?.toLowerCase() === searchStr);
        if (cb) { cb.checked = add; cb.dispatchEvent(new Event('change')); window.updateDistCount(cb); }
    } else {
        let cb = document.querySelector(`.const-check[value="${idOrName}"]`);
        if (!cb) cb = Array.from(document.querySelectorAll('.const-check')).find(el => el.dataset.name?.toLowerCase() === searchStr);
        if (cb) { cb.checked = add; cb.dispatchEvent(new Event('change')); window.updateCount(cb); }
    }
    map.closePopup();
};

// ─── Stats recalculation ─────────────────────────────────────────────────────
window.recalculateCampaignStats = function(distanceKm, durationHours) {
    const mileage   = parseFloat(document.getElementById('formMileage')?.value)   || 15;
    const fuelPrice = parseFloat(document.getElementById('formFuelPrice')?.value) || 102;

    const fuelNeeded = distanceKm / mileage;
    const totalCost  = fuelNeeded * fuelPrice;
    const days       = Math.max(1, Math.round((distanceKm / 300) + 0.4));
    const hours      = durationHours || (distanceKm / 60.0);

    const currency = window.sessionCurrency || '₹';

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('statsDistVal',   distanceKm.toFixed(1) + ' km');
    set('statsFuelVal',   fuelNeeded.toFixed(2) + ' L');
    set('statsCostVal',   currency + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
    set('statsDaysVal',   days);
    set('statsStopsVal',  window.routeStops.length);
    set('statTotalKm',    distanceKm.toFixed(1) + ' km');
    set('statFuel',       fuelNeeded.toFixed(2) + ' L');
    set('statCost',       currency + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
    set('statDays',       days);
    set('statTravelTime', hours.toFixed(1) + ' hrs');

    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
    const selectedCount  = window.routeStops.length;
    set('statDistricts',    isDistrictMode ? selectedCount : (new Set(document.querySelectorAll('.const-check:checked')).size || 0));
    set('statConstituencies', isDistrictMode ? '-' : selectedCount);

    const coveragePct = isDistrictMode
        ? ((selectedCount / 38) * 100).toFixed(1) + '%'
        : ((selectedCount / 234) * 100).toFixed(1) + '%';
    set('statCoverage', coveragePct);

    console.log('╔══════════════════════════════════════════════════');
    console.log('║ [Campaign Stats] Metrics recalculated');
    console.log('║ Distance    :', distanceKm.toFixed(1), 'km');
    console.log('║ Duration    :', hours.toFixed(2), 'hrs');
    console.log('║ Fuel Needed :', fuelNeeded.toFixed(2), 'L');
    console.log('║ Total Cost  :', currency + totalCost.toFixed(0));
    console.log('║ Days        :', days);
    console.log('║ Stops       :', window.routeStops.length);
    console.log('╚══════════════════════════════════════════════════');

    window.updateTourScheduleTimeline(days);
};

// ─── Tour schedule timeline ───────────────────────────────────────────────────
window.updateTourScheduleTimeline = function(days) {
    const container = document.getElementById('tourScheduleWrapper');
    if (!container) return;

    if (!window.routeStops || window.routeStops.length === 0) {
        container.innerHTML = `
            <div class="flex-1 flex flex-col items-center justify-center text-center p-4">
                <div class="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-base mb-2">
                    <i class="fa-solid fa-route"></i>
                </div>
                <p class="text-[10px] text-gray-400 max-w-[180px] leading-normal">Select districts or constituencies and click Generate Route.</p>
            </div>
        `;
        return;
    }

    const stopDurHrs   = parseFloat(document.getElementById('stopDurationHrs')?.value) || 2.0;
    const maxHrsPerDay = 10.0;
    const stopsPerDay  = Math.max(1, Math.floor(maxHrsPerDay / stopDurHrs));
    const actualDays   = Math.max(1, Math.ceil(window.routeStops.length / stopsPerDay));

    let html = '<div class="space-y-2">';

    for (let dayIdx = 0; dayIdx < actualDays; dayIdx++) {
        const dayStops = window.routeStops.filter((_, i) => Math.floor(i / stopsPerDay) === dayIdx)
            .map((name, sIdx) => ({ name, overallIdx: dayIdx * stopsPerDay + sIdx }));

        if (!dayStops.length) continue;

        const isOpen = dayIdx === 0 ? 'open' : '';
        html += `
            <div class="border border-gray-100 dark:border-white/5 rounded-xl overflow-hidden bg-gray-50 dark:bg-white/5 mb-2">
                <details class="group" ${isOpen}>
                    <summary class="flex items-center justify-between py-2 px-3 font-semibold text-xs cursor-pointer select-none bg-primary/5 text-primary">
                        <span>Day ${dayIdx + 1} Plan (${dayStops.length} stops)</span>
                        <i class="fa-solid fa-chevron-down text-[9px] text-gray-400 transition-transform group-open:rotate-180"></i>
                    </summary>
                    <div class="p-3 border-t border-gray-100 dark:border-white/5 space-y-2">
        `;

        let startTime = 9.0;
        dayStops.forEach((s, idx) => {
            const isFirst = s.overallIdx === 0;
            const isLast  = s.overallIdx === window.routeStops.length - 1;
            const hr   = Math.floor(startTime);
            const min  = Math.round((startTime - hr) * 60);
            const ampm = hr >= 12 ? 'PM' : 'AM';
            const hr12 = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
            const timeStr = `${hr12}:${min.toString().padStart(2, '0')} ${ampm}`;
            const dotColor = isFirst ? 'bg-primary' : (isLast ? 'bg-red-500' : 'bg-secondary');

            html += `
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded-full ${dotColor} flex items-center justify-center text-white text-[7px] font-bold flex-shrink-0">
                        ${isFirst ? '<i class="fa-solid fa-flag text-[6px]"></i>' : (isLast ? '<i class="fa-solid fa-map-pin text-[6px]"></i>' : (s.overallIdx + 1))}
                    </div>
                    <div class="flex-1 py-1 px-2 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-lg flex justify-between items-center min-w-0">
                        <span class="font-semibold text-[9px] text-gray-700 dark:text-gray-300 truncate" title="${s.name}">${s.name}</span>
                        <span class="text-[8px] font-bold text-gray-500 ml-1 flex-shrink-0">${timeStr}</span>
                        ${isFirst ? '<span class="text-[6px] font-bold uppercase text-primary ml-1">Start</span>' : ''}
                        ${isLast  ? '<span class="text-[6px] font-bold uppercase text-red-500 ml-1">End</span>' : ''}
                    </div>
                </div>
                ${idx < dayStops.length - 1 ? '<div class="ml-2 w-px h-1 bg-gray-200 dark:bg-white/10"></div>' : ''}
            `;
            startTime += stopDurHrs;
        });

        html += `</div></details></div>`;
    }

    html += '</div>';
    container.innerHTML = html;
};

// ─── Fuel type switcher ───────────────────────────────────────────────────────
window.switchFuelType = function(type) {
    window.currentFuelType = type;
    ['Petrol', 'Diesel', 'Electric', 'CNG'].forEach(t => {
        const btn = document.getElementById('fuelTab' + t);
        if (btn) btn.classList.toggle('active', t === type);
        const el = document.getElementById('params' + t);
        if (el) el.classList.toggle('hidden', t !== type);
    });
    window.syncVehicleInputs();
};

window.selectVehicle = function(vehicleId) {
    if (!vehicleId) return;
    const v = window.vehiclesData?.find(item => String(item.id) === String(vehicleId));
    if (!v) return;
    let ft = ['Petrol', 'Diesel', 'Electric', 'CNG'].includes(v.fuel_type) ? v.fuel_type : 'Petrol';
    window.switchFuelType(ft);
    if (ft === 'Petrol')   document.getElementById('petrolMileage').value  = v.mileage;
    else if (ft === 'Diesel')   document.getElementById('dieselMileage').value  = v.mileage;
    else if (ft === 'Electric') { document.getElementById('evRange').value = v.mileage; document.getElementById('evBattery').value = v.tank_size || 60; }
    else if (ft === 'CNG')      document.getElementById('cngMileage').value = v.mileage;
    window.syncVehicleInputs();
};

window.syncVehicleInputs = function() {
    const formMil   = document.getElementById('formMileage');
    const formPrice = document.getElementById('formFuelPrice');
    if (!formMil || !formPrice) return;
    if (window.currentFuelType === 'Petrol') {
        formMil.value   = document.getElementById('petrolMileage')?.value;
        formPrice.value = document.getElementById('petrolPrice')?.value;
    } else if (window.currentFuelType === 'Diesel') {
        formMil.value   = document.getElementById('dieselMileage')?.value;
        formPrice.value = document.getElementById('dieselPrice')?.value;
    } else if (window.currentFuelType === 'Electric') {
        const range    = parseFloat(document.getElementById('evRange')?.value)   || 350;
        const battery  = parseFloat(document.getElementById('evBattery')?.value) || 60;
        const costKwh  = parseFloat(document.getElementById('evPrice')?.value)   || 8;
        formMil.value   = (range / battery).toFixed(3);
        formPrice.value = costKwh;
    } else if (window.currentFuelType === 'CNG') {
        formMil.value   = document.getElementById('cngMileage')?.value;
        formPrice.value = document.getElementById('cngPrice')?.value;
    }
    window.triggerLivePreviewRecalc();
};

// ─── Accordion ────────────────────────────────────────────────────────────────
window.toggleAccordion = function(id) {
    const content = document.getElementById('content-' + id);
    const icon    = document.getElementById('icon-' + id);
    if (!content) return;
    const isHidden = content.classList.contains('hidden');
    content.classList.toggle('hidden', !isHidden);
    if (icon) icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
    if (isHidden) activateDistrictGIS(id);
};

// ─── District selection state ─────────────────────────────────────────────────
window.isDistrictSelectedState = function(distId) {
    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
    if (isDistrictMode) {
        const cb = document.querySelector(`.dist-check[value="${distId}"]`);
        return (cb && cb.checked) ? 'all' : 'none';
    }
    const consts  = document.querySelectorAll(`.const-check[data-district-id="${distId}"]`);
    const checked = document.querySelectorAll(`.const-check[data-district-id="${distId}"]:checked`);
    if (!consts.length || !checked.length) return 'none';
    return checked.length === consts.length ? 'all' : 'partial';
};
window.isDistrictSelected = distId => window.isDistrictSelectedState(distId) !== 'none';

window.toggleDistrictSelection = function(distId) {
    console.log(`[Campaign] Toggling district selection: ${distId}`);
    const cb = document.querySelector(`.dist-check[value="${distId}"]`);
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); window.updateDistrictMarkerStyle(distId); }
};

window.toggleDistrictConstituenciesSelection = function(distId) {
    console.log(`[Campaign] Toggling all constituencies for district: ${distId}`);
    const cbs = document.querySelectorAll(`.const-check[data-district-id="${distId}"]`);
    if (!cbs.length) return;
    const allChecked = Array.from(cbs).every(cb => cb.checked);
    cbs.forEach(cb => { cb.checked = !allChecked; cb.dispatchEvent(new Event('change')); });
    const contentDiv = document.getElementById('content-' + distId);
    const icon       = document.getElementById('icon-' + distId);
    if (contentDiv && !allChecked) {
        contentDiv.classList.remove('hidden');
        if (icon) icon.style.transform = 'rotate(90deg)';
    }
    window.updateCount();
};

// ─── District marker style ────────────────────────────────────────────────────
window.updateDistrictMarkerStyle = function(distId) {
    const marker = districtMarkers[distId];
    if (!marker) return;
    const d     = window.allDistricts.find(x => x.id === distId);
    const code  = d ? (d.code || d.name.slice(0, 3).toUpperCase()) : distId.slice(0, 3).toUpperCase();
    const state = window.isDistrictSelectedState(distId);
    marker.setIcon(createDistrictHexIcon(code, state === 'all', state === 'partial'));
};

window.isConstituencySelected = constId => {
    const cb = document.querySelector(`.const-check[value="${constId}"]`);
    return cb ? cb.checked : false;
};

window.toggleConstituencySelection = function(constId) {
    console.log(`[Campaign] Toggling constituency: ${constId}`);
    const cb = document.querySelector(`.const-check[value="${constId}"]`);
    if (!cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
    if (cb.checked) {
        const distId = cb.dataset.districtId;
        const contentDiv = document.getElementById('content-' + distId);
        const icon       = document.getElementById('icon-' + distId);
        if (contentDiv?.classList.contains('hidden')) {
            contentDiv.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(90deg)';
        }
    }
    window.updateConstituencyMarkerStyle(constId);
};

window.updateConstituencyMarkerStyle = function(constId) {
    const marker = constituencyMarkers[constId];
    const poly   = constituencyPolygons[constId];
    const isSel  = window.isConstituencySelected(constId);

    if (marker) {
        marker.setStyle(isSel
            ? { radius: 6.5, fillColor: '#F1C40F', color: '#FFD700', weight: 2.5, fillOpacity: 1.0 }
            : { radius: 3.5, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1,   fillOpacity: 0.65 });
        if (marker._path) marker._path.classList.toggle('glowing-marker-const', isSel);
    }
    if (poly) {
        poly.setStyle(isSel
            ? { color: '#FFD700', fillColor: '#F1C40F', weight: 2.5, fillOpacity: 0.35, opacity: 0.95 }
            : { color: '#18A06A', fillColor: '#0F7B53', weight: 1,   fillOpacity: 0.05, opacity: 0.25 });
        if (poly._path) poly._path.classList.toggle('glowing-polygon', isSel);
    }
};

window.syncMarkerStylesWithCheckboxes = function() {
    window.allDistricts?.forEach(d     => window.updateDistrictMarkerStyle(d.id));
    window.allConstituencies?.forEach(c => window.updateConstituencyMarkerStyle(c.id));
};

window.selectDistrictConsts = function(id, checked) {
    const content = document.getElementById('content-' + id);
    if (!content) return;
    content.querySelectorAll('.const-check').forEach(cb => {
        if (cb.closest('.const-item-checkbox')?.style.display !== 'none') cb.checked = checked;
    });
    window.updateCount();
};

// ─── Route Optimization (nearest-neighbor + 2-opt) ───────────────────────────
function optimizeRouteJS(stops, coordinatesMap) {
    if (stops.length <= 2) return { route: stops, distanceSaved: 0, method: 'direct' };

    function haversineDeg(a, b) {
        const c1 = coordinatesMap[a], c2 = coordinatesMap[b];
        if (!c1 || !c2) return 9999;
        const R  = 6371;
        const dLat = (c2[0] - c1[0]) * Math.PI / 180;
        const dLng = (c2[1] - c1[1]) * Math.PI / 180;
        const sin1 = Math.sin(dLat / 2);
        const sin2 = Math.sin(dLng / 2);
        const a_   = sin1 * sin1 + Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) * sin2 * sin2;
        return R * 2 * Math.atan2(Math.sqrt(a_), Math.sqrt(1 - a_));
    }

    function routeDistance(route) {
        let d = 0;
        for (let i = 0; i < route.length - 1; i++) d += haversineDeg(route[i], route[i + 1]);
        return d;
    }

    const first     = stops[0];
    const origDist  = routeDistance(stops);

    let route;
    if (stops.length <= 8) {
        // Brute-force permutations for small sets
        function permutations(arr) {
            if (!arr.length) return [[]];
            return arr.flatMap((v, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [v, ...p]));
        }
        const perms = permutations(stops.slice(1));
        let minD = Infinity;
        route = stops;
        perms.forEach(perm => {
            const r = [first, ...perm];
            const d = routeDistance(r);
            if (d < minD) { minD = d; route = r; }
        });
    } else {
        // Nearest-neighbor greedy
        let unvisited = stops.slice(1);
        let current   = first;
        route         = [current];
        while (unvisited.length > 0) {
            let nearestIdx = 0, minD = Infinity;
            unvisited.forEach((s, i) => { const d = haversineDeg(current, s); if (d < minD) { minD = d; nearestIdx = i; } });
            current = unvisited[nearestIdx];
            route.push(current);
            unvisited.splice(nearestIdx, 1);
        }
        // 2-opt improvement
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 1; i < route.length - 2; i++) {
                for (let j = i + 1; j < route.length; j++) {
                    if (j - i === 1) continue;
                    const newRoute = [...route.slice(0, i), ...route.slice(i, j).reverse(), ...route.slice(j)];
                    if (routeDistance(newRoute) < routeDistance(route)) { route = newRoute; improved = true; }
                }
            }
        }
    }

    const optimizedDist  = routeDistance(route);
    const distanceSaved  = Math.max(0, origDist - optimizedDist);

    console.log('╔══════════════════════════════════════════════════');
    console.log('║ [Campaign Optimization] Route optimized');
    console.log('║ Input order   :', stops.join(' → '));
    console.log('║ Optimal order :', route.join(' → '));
    console.log('║ Distance saved:', distanceSaved.toFixed(1), 'km');
    console.log('║ Method        :', stops.length <= 8 ? 'Brute-force' : 'Nearest-neighbor + 2-opt');
    console.log('╚══════════════════════════════════════════════════');

    return { route, distanceSaved, method: stops.length <= 8 ? 'exact' : '2-opt' };
}

// ─── Live route debounce ──────────────────────────────────────────────────────
let liveRouteTimeout = null;

window.triggerLiveRouteRecalc = function() {
    if (liveRouteTimeout) clearTimeout(liveRouteTimeout);
    liveRouteTimeout = setTimeout(() => window.generateLiveCampaignRoute(), 600);
};

window.generateLiveCampaignRoute = async function() {
    if (!map) return;

    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
    const selector  = isDistrictMode ? '.dist-check:checked' : '.const-check:checked';
    const checks    = document.querySelectorAll(selector);

    console.log('╔══════════════════════════════════════════════════');
    console.log('║ [Campaign Route] Generating live route');
    console.log(`║ Mode          : ${isDistrictMode ? 'District' : 'Constituency'}`);
    console.log('║ Selected count:', checks.length);
    console.log('╚══════════════════════════════════════════════════');

    if (checks.length < 2) {
        if (serverRouteGroup) { map.removeLayer(serverRouteGroup); serverRouteGroup = null; }
        if (liveRouteGroup)   { map.removeLayer(liveRouteGroup);   liveRouteGroup   = null; }
        window.routeStops = [];
        window.recalculateCampaignStats(0, 0);
        return;
    }

    const selectedStops = Array.from(checks).map(cb => cb.dataset.name || cb.value);

    console.log('║ Selected stops:', selectedStops);

    // Validate all stops have coordinates
    const invalidStops = selectedStops.filter(s => !getCampaignCoordinate(s));
    if (invalidStops.length > 0) {
        console.warn('[Campaign Validation] No coordinates for:', invalidStops);
        showCampaignToast(`No coordinates found for: ${invalidStops.join(', ')}`, 'error');
    }

    const validStops = selectedStops.filter(s => getCampaignCoordinate(s));
    if (validStops.length < 2) {
        showCampaignToast('Route requires at least 2 valid locations with known coordinates.', 'error');
        return;
    }

    const coordsMap  = {};
    validStops.forEach(s => { coordsMap[s] = getCampaignCoordinate(s); });

    const { route, distanceSaved } = optimizeRouteJS(validStops, coordsMap);
    window.routeStops = route;

    console.log('║ Optimized route:', route.join(' → '));
    console.log('║ Distance saved :', distanceSaved.toFixed(1), 'km');

    // Show optimization badge
    const badge = document.getElementById('estimateBadge');
    if (badge) {
        badge.textContent = distanceSaved > 1 ? `Saved ~${distanceSaved.toFixed(0)}km` : 'Route Ready';
        badge.classList.remove('hidden');
    }

    await renderServerRoute();
};

// ─── Count update functions ───────────────────────────────────────────────────
window.updateCount = function(changedCb) {
    const selectedCheckboxes = document.querySelectorAll('.const-check:checked');
    const totalSelected = selectedCheckboxes.length;
    const uniqueDistricts = new Set(Array.from(selectedCheckboxes).map(cb => cb.dataset.districtId));

    const label = document.getElementById('selectedCountLabel');
    if (label) label.innerHTML = `Selected: <span class="text-primary font-black">${totalSelected} Constituencies</span>, <span class="text-secondary font-black">${uniqueDistricts.size} Districts</span>`;

    document.querySelectorAll('#campaignForm button[type="submit"]').forEach(btn => { btn.disabled = totalSelected === 0; });

    window.syncMarkerStylesWithCheckboxes();
    window.updateLivePreview(totalSelected, uniqueDistricts.size, changedCb);
    window.triggerLiveRouteRecalc();

    console.log(`[Campaign] Constituencies selected: ${totalSelected} across ${uniqueDistricts.size} districts`);
};

window.updateDistCount = function(changedCb) {
    const selectedCheckboxes = document.querySelectorAll('.dist-check:checked');
    const totalSelected = selectedCheckboxes.length;
    const selectedNames = Array.from(selectedCheckboxes).map(cb => cb.dataset.name || cb.value);

    const label = document.getElementById('selectedCountLabel');
    if (label) label.innerHTML = `Selected: <span class="text-primary font-black">${totalSelected} Districts</span>`;

    document.querySelectorAll('#campaignForm button[type="submit"]').forEach(btn => { btn.disabled = totalSelected === 0; });

    window.syncMarkerStylesWithCheckboxes();
    window.updateLivePreview(totalSelected, totalSelected, changedCb);
    window.triggerLiveRouteRecalc();

    console.log('[Campaign] Districts selected:', selectedNames);
};

window.updateLivePreview = function(count, districtCount, changedCb) {
    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';

    if (window.routeStops?.length > 0) {
        const readyBadge = document.getElementById('readyBadge');
        if (readyBadge) readyBadge.classList.remove('hidden');
        const el = document.getElementById('statsStopsVal');
        if (el) el.textContent = window.routeStops.length;
    } else {
        const readyBadge = document.getElementById('readyBadge');
        if (readyBadge) readyBadge.classList.add('hidden');

        ['statsDistVal','statsFuelVal','statsCostVal','statsDaysVal','statTotalKm','statFuel','statCost','statDays','statTravelTime'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = id.includes('Fuel') || id.includes('fuel') ? '0 L' : (id.includes('Cost') || id.includes('cost') ? '₹0' : (id.includes('Time') ? '0 hrs' : '0 km'));
        });
        const el = document.getElementById('statsStopsVal');
        if (el) el.textContent = '0';

        const distEl = document.getElementById('statDistricts');
        if (distEl) distEl.textContent = isDistrictMode ? count : districtCount;
        const constEl = document.getElementById('statConstituencies');
        if (constEl) constEl.textContent = isDistrictMode ? '-' : count;
        const covEl = document.getElementById('statCoverage');
        if (covEl) covEl.textContent = isDistrictMode ? `${((count / 38) * 100).toFixed(1)}%` : `${((count / 234) * 100).toFixed(1)}%`;

        if (map) updateMapSelections(changedCb);
    }
};

window.triggerLivePreviewRecalc = function() {
    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
    if (isDistrictMode) window.updateDistCount(); else window.updateCount();
};

// ─── Quick select / clear ─────────────────────────────────────────────────────
window.quickSelectConst = function(n) {
    const checks = document.querySelectorAll('.const-check');
    checks.forEach((c, i) => {
        c.checked = i < n;
        const distId     = c.dataset.districtId;
        const contentDiv = document.getElementById('content-' + distId);
        const icon       = document.getElementById('icon-' + distId);
        if (contentDiv && i < n && contentDiv.classList.contains('hidden')) {
            contentDiv.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(90deg)';
        }
    });
    window.updateCount();
};

window.quickSelectDist = function(n) {
    document.querySelectorAll('.dist-check').forEach((c, i) => { c.checked = i < n; });
    window.updateDistCount();
};

window.clearAll = function() {
    document.querySelectorAll('.const-check').forEach(c => c.checked = false);
    window.updateCount();
    document.querySelectorAll('.district-accordion-item').forEach(item => {
        const distId = item.id.replace('district-item-', '');
        const content = document.getElementById('content-' + distId);
        const icon    = document.getElementById('icon-' + distId);
        if (content) content.classList.add('hidden');
        if (icon)    icon.style.transform = 'rotate(0deg)';
    });
    if (!window.routeStops?.length) window.resetMapZoom();
};

window.clearDistAll = function() {
    document.querySelectorAll('.dist-check').forEach(c => c.checked = false);
    window.updateDistCount();
    if (!window.routeStops?.length) window.resetMapZoom();
};

window.applyAccordionFilters = function() {
    const q          = (document.getElementById('constSearch')?.value || '').toLowerCase();
    const distFilter = (document.getElementById('districtFilter')?.value || '').toLowerCase();

    document.querySelectorAll('.district-accordion-item').forEach(districtItem => {
        const districtName = (districtItem.querySelector('.district-accordion-header span')?.textContent || '').toLowerCase();
        const districtId   = districtItem.id.replace('district-item-', '');
        const contentDiv   = document.getElementById('content-' + districtId);
        const icon         = document.getElementById('icon-' + districtId);

        let hasVisible = false;
        const matchesDist = !distFilter || districtName.includes(distFilter);

        districtItem.querySelectorAll('.const-item-checkbox').forEach(label => {
            const matches = (!q || (label.dataset.name || '').toLowerCase().includes(q)) && matchesDist;
            label.style.display = matches ? 'flex' : 'none';
            if (matches) hasVisible = true;
        });

        districtItem.style.display = (hasVisible && matchesDist) ? 'block' : 'none';
        if ((q || distFilter) && hasVisible && contentDiv?.classList.contains('hidden')) {
            contentDiv.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(90deg)';
        }
    });
};

window.applyDistrictFilters = function() {
    const q = (document.getElementById('constSearch')?.value || '').toLowerCase();
    document.querySelectorAll('#districtGrid .const-item-checkbox').forEach(label => {
        label.style.display = (!q || (label.dataset.name || '').toLowerCase().includes(q)) ? 'flex' : 'none';
    });
};

// ─── Map controls ─────────────────────────────────────────────────────────────
window.zoomToDistrictGIS = function(distId) { if (distId) activateDistrictGIS(distId); };

window.clearCampaignRoute = function() {
    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
    if (isDistrictMode) window.clearDistAll(); else window.clearAll();
    if (serverRouteGroup) { map.removeLayer(serverRouteGroup); serverRouteGroup = null; }
    window.routeStops = [];
    window.recalculateCampaignStats(0, 0);
};

window.resetMapZoom = function() {
    if (!map) return;
    map.flyTo([11.1271, 78.6569], 7, { animate: true, duration: 0.7 });
    map.closePopup();
    deactivateActiveDistrictGIS();
    updateViewportRendering();
};

window.fitRouteBounds = function() {
    if (!map || !window.routeStops?.length) { window.resetMapZoom(); return; }
    const coords = window.routeStops.map(s => getCampaignCoordinate(s)).filter(Boolean);
    if (coords.length > 0) {
        try { map.fitBounds(L.latLngBounds(coords), { padding: [60, 60], maxZoom: 13 }); } catch(e) {}
    }
};

window.submitCampaignForm = function() {
    const form = document.getElementById('campaignForm');
    if (form) form.submit();
};

window.toggleMapLayer = function(layerName) {
    if (layerName === 'highways') {
        const cb = document.getElementById('layerHighways');
        if (cb?.checked) map.addLayer(mapLayers.highways); else map.removeLayer(mapLayers.highways);
    } else if (layerName === 'konguTowns') {
        const cb = document.getElementById('layerKonguTowns');
        if (cb?.checked) { if (!map.hasLayer(mapLayers.konguTowns)) map.addLayer(mapLayers.konguTowns); }
        else { if (map.hasLayer(mapLayers.konguTowns)) map.removeLayer(mapLayers.konguTowns); }
    } else {
        updateViewportRendering();
    }
};

// ─── Toast helper ─────────────────────────────────────────────────────────────
function showCampaignToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'fw-toast ' + (type === 'error' ? 'error' : '');
    toast.innerHTML = `<i class="fa-solid fa-${type === 'error' ? 'circle-xmark' : 'circle-check'}"></i><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity   = '0';
        setTimeout(() => toast.remove(), 400);
    }, type === 'error' ? 5000 : 3000);
}

// ─── Viewport-aware rendering ─────────────────────────────────────────────────
function updateViewportRendering() {
    if (!map) return;
    const bounds = map.getBounds();
    const zoom   = map.getZoom();

    // District markers — always visible (they are divIcons, always in layer)
    for (const distId in districtMarkers) {
        const marker = districtMarkers[distId];
        const circle = districtBoundsCircles[distId];
        const inViewport = bounds.contains(marker.getLatLng());
        if (inViewport) {
            if (!mapLayers.districts.hasLayer(marker)) mapLayers.districts.addLayer(marker);
            if (circle && !mapLayers.districts.hasLayer(circle)) mapLayers.districts.addLayer(circle);
        } else {
            if (mapLayers.districts.hasLayer(marker)) mapLayers.districts.removeLayer(marker);
            if (circle && mapLayers.districts.hasLayer(circle)) mapLayers.districts.removeLayer(circle);
        }
    }

    // Constituencies — only at zoom >= 9
    const constCb      = document.getElementById('layerConstituencies');
    const constEnabled = constCb ? constCb.checked : true;
    const showConst    = constEnabled && zoom >= 9;

    window.allConstituencies?.forEach(c => {
        const marker = constituencyMarkers[c.id];
        const poly   = constituencyPolygons[c.id];
        if (!marker) return;
        const inViewport = bounds.contains(marker.getLatLng());
        if (inViewport && showConst) {
            if (poly && !map.hasLayer(poly))   map.addLayer(poly);
            if (!map.hasLayer(marker))          map.addLayer(marker);
        } else {
            if (poly && map.hasLayer(poly))    map.removeLayer(poly);
            if (map.hasLayer(marker))           map.removeLayer(marker);
        }
    });

    // Active district GIS POIs
    if (currentActiveDistrictId && districtGISGroups[currentActiveDistrictId]) {
        districtGISGroups[currentActiveDistrictId].eachLayer(layer => {
            if (layer.isConstituency) return;
            let inViewport = false;
            if (layer.getLatLng) inViewport = bounds.contains(layer.getLatLng());
            else if (layer.getBounds) inViewport = bounds.intersects(layer.getBounds());

            const categoryMap = {
                'government': 'government', 'municipality': 'government', 'town_panchayat': 'government',
                'bus_stand': 'transport',   'railway': 'transport', 'airport': 'transport', 'port': 'transport',
                'hospital': 'hospitals',    'temple': 'temples',   'tourist': 'temples',   'college': 'temples'
            };
            const cat = layer.poiType ? (categoryMap[layer.poiType] || 'temples') : null;
            const catEnabled = cat ? (document.getElementById('layer' + cat.charAt(0).toUpperCase() + cat.slice(1))?.checked !== false) : true;

            if (inViewport && catEnabled) { if (!map.hasLayer(layer)) map.addLayer(layer); }
            else                          { if (map.hasLayer(layer))  map.removeLayer(layer); }
        });
    }
}

function activateDistrictGISQuiet(distId) {
    if (currentActiveDistrictId && currentActiveDistrictId !== distId) {
        const prevGroup = districtGISGroups[currentActiveDistrictId];
        if (prevGroup) prevGroup.eachLayer(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
    }
    currentActiveDistrictId = distId;
}

function activateDistrictGIS(distId) {
    if (!distId || !map) return;
    const d = window.allDistricts.find(item => String(item.id) === String(distId));
    if (!d) return;

    map.flyTo([d.lat, d.lng], 10, { animate: true, duration: 0.7 });
    activateDistrictGISQuiet(distId);

    const hqMarker = districtMarkers[distId];
    if (hqMarker) {
        hqMarker.bindPopup(`
            <div class="space-y-1.5 p-0.5">
                <div class="text-xs font-black text-primary">${d.name} District</div>
                <div class="text-[9px] text-gray-400 font-bold">Headquarters: ${d.hq}</div>
                <div class="text-[9px] text-gray-400">Area code: ${d.code || '-'}</div>
            </div>
        `).openPopup();
    }
    updateViewportRendering();
}

function deactivateActiveDistrictGIS() {
    if (currentActiveDistrictId) {
        const prevGroup = districtGISGroups[currentActiveDistrictId];
        if (prevGroup) prevGroup.eachLayer(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
        currentActiveDistrictId = null;
    }
}

// ─── Live selection markers ───────────────────────────────────────────────────
function updateMapSelections(changedCb) {
    if (!map) return;
    if (liveRouteGroup) map.removeLayer(liveRouteGroup);
    liveRouteGroup = L.layerGroup().addTo(map);

    const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
    const checks = document.querySelectorAll(isDistrictMode ? '.dist-check:checked' : '.const-check:checked');

    const coords = [];
    checks.forEach(cb => {
        const name     = cb.dataset.name;
        const ptCoords = getCampaignCoordinate(name);
        if (ptCoords) {
            coords.push(ptCoords);
            const marker = L.circleMarker(ptCoords, {
                radius: 6, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1.5, fillOpacity: 0.95
            }).addTo(liveRouteGroup);
            marker.bindPopup(getCampaignPopupHtml(name, isDistrictMode ? 'District Capital' : 'Assembly Constituency'));
        }
    });

    if (coords.length > 0 && changedCb) {
        try { map.fitBounds(L.latLngBounds(coords), { padding: [50, 50], maxZoom: 12 }); } catch(e) {}
    }
}

// ─── Route rendering ──────────────────────────────────────────────────────────
async function renderServerRoute() {
    if (serverRouteGroup) { map.removeLayer(serverRouteGroup); serverRouteGroup = null; }

    const stopCoords = window.routeStops
        .map(name => {
            const c = getCampaignCoordinate(name);
            return c ? [c[0], c[1], name] : null;
        })
        .filter(Boolean);

    if (stopCoords.length < 2) {
        console.warn('[Campaign Route] Fewer than 2 routable stops after coordinate lookup.');
        showCampaignToast('Route requires at least 2 locations with known coordinates.', 'error');
        return;
    }

    const names      = stopCoords.map(c => c[2]);
    const coordsOnly = stopCoords.map(c => [c[0], c[1]]);

    console.log('╔══════════════════════════════════════════════════');
    console.log('║ [Campaign Route] Rendering route');
    console.log('║ Origin     :', names[0]);
    console.log('║ Destination:', names[names.length - 1]);
    console.log('║ Waypoints  :', names.length > 2 ? names.slice(1, -1) : '(none)');
    console.log('║ Full route :', names.join(' → '));
    console.log('╚══════════════════════════════════════════════════');

    try {
        const routeData = await window.routingProvider.resolveRoute(names, coordsOnly, false);

        // Validate geometry
        if (!routeData || !routeData.geometry || !routeData.geometry.coordinates || routeData.geometry.coordinates.length < 2) {
            const wpts = names.slice(1, -1);
            const errMsg = wpts.length > 0
                ? `Unable to create route through specified waypoint: ${wpts.join(', ')}`
                : 'Route geometry is invalid. Please try different locations.';
            console.error('[Campaign Route Validation]', errMsg);
            showCampaignToast(errMsg, 'error');
            return;
        }

        console.log('[Campaign Route] OSRM resolved →', {
            distance: routeData.distance.toFixed(1) + ' km',
            duration: routeData.duration.toFixed(2) + ' hrs',
            source: routeData.source,
            generatedRoute: names.join(' → ')
        });

        // Draw route
        const outerGlow = L.geoJSON(routeData.geometry, { style: { color: '#0F7B53', weight: 9,  opacity: 0.3 } });
        const coreLine  = L.geoJSON(routeData.geometry, { style: { color: '#2ECC71', weight: 4,  opacity: 0.95 } });
        const dashedLine = L.geoJSON(routeData.geometry, { style: { color: '#ffffff', weight: 1, opacity: 0.15, dashArray: '6 8' } });

        // Render stop pins
        const routeNodes = stopCoords.map((coord, idx) => {
            const isStart = idx === 0;
            const isEnd   = idx === stopCoords.length - 1;
            const pinColor = isStart ? '#2ECC71' : (isEnd ? '#EF4444' : '#F39C12');
            const label    = isStart ? 'A' : (isEnd ? 'B' : String(idx));
            const icon     = createRoutePinIcon(pinColor, label);

            const marker = L.marker([coord[0], coord[1]], { icon, zIndexOffset: 1000 });
            let popupText = `<div class="text-xs font-bold text-gray-100">${coord[2]}</div>`;
            if (isStart) popupText += `<div class="text-[9px] uppercase text-primary font-black mt-0.5">Start Point</div>`;
            else if (isEnd) popupText += `<div class="text-[9px] uppercase text-red-500 font-black mt-0.5">Destination</div>`;
            else popupText += `<div class="text-[9px] text-gray-400">Waypoint #${idx}</div>`;
            marker.bindPopup(popupText);
            return marker;
        });

        serverRouteGroup = L.layerGroup([outerGlow, coreLine, dashedLine, ...routeNodes]).addTo(map);

        // Auto-fit bounds
        try {
            const bounds = outerGlow.getBounds();
            map.fitBounds(bounds, { padding: [60, 60], maxZoom: 13 });
        } catch(e) {}

        // Show optimized badge
        const readyBadge = document.getElementById('readyBadge');
        if (readyBadge) readyBadge.classList.remove('hidden');

        // Recalculate stats from real OSRM data
        window.recalculateCampaignStats(routeData.distance, routeData.duration);

    } catch(e) {
        console.error('[Campaign Route] OSRM failed, drawing straight-line fallback.', e);

        const wpts = names.slice(1, -1);
        if (wpts.length > 0) {
            showCampaignToast(`Unable to create route through specified waypoint: ${wpts.join(', ')}`, 'error');
        } else {
            showCampaignToast('Route calculation failed. Showing direct path fallback.', 'error');
        }

        // Fallback straight lines
        const baseGlow  = L.polyline(coordsOnly, { color: '#2ECC71', weight: 9,  opacity: 0.3 });
        const coreLine  = L.polyline(coordsOnly, { color: '#0F7B53', weight: 3,  opacity: 0.95 });
        const fallbackNodes = stopCoords.map((coord, idx) => {
            const isStart = idx === 0;
            const isEnd   = idx === stopCoords.length - 1;
            return L.circleMarker([coord[0], coord[1]], {
                radius: isStart || isEnd ? 9 : 6,
                fillColor: isStart ? '#0F7B53' : (isEnd ? '#EF4444' : '#F39C12'),
                color: '#FFFFFF', weight: 2, fillOpacity: 0.95
            }).bindPopup(`<b>${coord[2]}</b><br>${isStart ? 'Start' : (isEnd ? 'End' : 'Stop')}`);
        });

        serverRouteGroup = L.layerGroup([baseGlow, coreLine, ...fallbackNodes]).addTo(map);
        const bounds = L.latLngBounds(coordsOnly);
        map.fitBounds(bounds, { padding: [60, 60] });

        // Estimate distance from Haversine
        let totalKm = 0;
        for (let i = 0; i < coordsOnly.length - 1; i++) {
            const a = coordsOnly[i], b = coordsOnly[i + 1];
            const dLat = (b[0] - a[0]) * Math.PI / 180;
            const dLng = (b[1] - a[1]) * Math.PI / 180;
            const s1   = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
            const aa   = s1 * s1 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * s2 * s2;
            totalKm += 6371 * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
        }
        window.recalculateCampaignStats(totalKm, totalKm / 60);
    }
}

// ─── Map Search ───────────────────────────────────────────────────────────────
window.handleMapSearch = function(val) {
    const resultsContainer = document.getElementById('mapSearchResults');
    if (!resultsContainer) return;
    const query = val.trim().toLowerCase();
    if (query.length < 2) { resultsContainer.innerHTML = ''; resultsContainer.classList.add('hidden'); return; }

    const matches = [];

    window.allDistricts?.forEach(d => {
        if (d.name.toLowerCase().includes(query) || d.hq.toLowerCase().includes(query))
            matches.push({ name: d.name, type: 'District', id: d.id, lat: d.lat, lng: d.lng });
    });
    window.allConstituencies?.forEach(c => {
        if (c.name.toLowerCase().includes(query))
            matches.push({ name: c.name, type: 'Constituency', id: c.id, districtId: c.district_id, lat: c.lat, lng: c.lng });
    });
    konguTowns.forEach(t => {
        if (t.name.toLowerCase().includes(query))
            matches.push({ name: t.name, type: 'Town', lat: t.lat, lng: t.lng });
    });
    if (window.majorCitiesCoords) {
        for (const city in window.majorCitiesCoords) {
            if (city.toLowerCase().includes(query) && !matches.some(m => m.name.toLowerCase() === city.toLowerCase())) {
                const c = window.majorCitiesCoords[city];
                matches.push({ name: city, type: 'City', lat: c[0], lng: c[1] });
            }
        }
    }
    window.combinedPlaces?.forEach(p => {
        if (p.name.toLowerCase().includes(query))
            matches.push({ name: p.name, type: p.type.toUpperCase().replace('_', ' '), lat: p.lat, lng: p.lng });
    });

    const limited = matches.slice(0, 8);
    if (!limited.length) {
        resultsContainer.innerHTML = `<div class="p-2.5 text-center text-xs text-gray-500">No results found</div>`;
        resultsContainer.classList.remove('hidden');
        return;
    }

    resultsContainer.innerHTML = limited.map(item => `
        <div class="search-result-item" onclick="selectSearchResult(${JSON.stringify(item).replace(/"/g, '&quot;')})">
            <span class="font-semibold">${item.name}</span>
            <span class="search-result-type">${item.type}</span>
        </div>
    `).join('');
    resultsContainer.classList.remove('hidden');
};

window.selectSearchResult = function(item) {
    const input = document.getElementById('mapSearchInput');
    if (input) input.value = item.name;
    const results = document.getElementById('mapSearchResults');
    if (results) { results.innerHTML = ''; results.classList.add('hidden'); }

    if (map) {
        map.flyTo([item.lat, item.lng], 12, { animate: true, duration: 0.7 });
        if (item.type === 'District')       activateDistrictGIS(item.id);
        else if (item.districtId)           activateDistrictGIS(item.districtId);
        else {
            const closest = window.findClosestDistrict?.(item.lat, item.lng);
            if (closest) activateDistrictGIS(closest.id);
        }
        L.popup().setLatLng([item.lat, item.lng]).setContent(getCampaignPopupHtml(item.name, item.type)).openOn(map);
    }
};

// ─── Locate user ──────────────────────────────────────────────────────────────
window.locateUser = function() {
    if (!navigator.geolocation) { showCampaignToast('Geolocation not supported.', 'error'); return; }
    navigator.geolocation.getCurrentPosition(
        pos => {
            map.flyTo([pos.coords.latitude, pos.coords.longitude], 13);
            L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
                radius: 8, fillColor: '#22C55E', color: '#ffffff', weight: 2, fillOpacity: 0.8
            }).addTo(map).bindPopup('<b>You are here</b>').openPopup();
        },
        err => { showCampaignToast('Location access denied or unavailable.', 'error'); }
    );
};

// ─── Main map initializer ─────────────────────────────────────────────────────
window.initCampaignMap = async function() {
    const skeleton = document.getElementById('mapSkeleton');
    if (skeleton) { skeleton.style.display = 'flex'; skeleton.style.opacity = '1'; }

    try {
        await window.lazyLoadMapResources();
    } catch(e) {
        console.error('[Campaign] Leaflet load failed', e);
        if (skeleton) skeleton.style.display = 'none';
        return;
    }

    // Init map with smooth performance settings
    map = L.map('plannerMap', {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        zoomAnimation: true,
        markerZoomAnimation: true,
        fadeAnimation: true,
        inertia: true,
        inertiaDeceleration: 2500,
        inertiaMaxSpeed: 1800,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        wheelDebounceTime: 30,
        wheelPxPerZoomLevel: 80,
        doubleClickZoom: true,
        tap: !L.Browser.mobile,
        maxBoundsViscosity: 0.6,
        bounceAtZoomLimits: false
    }).setView([11.1271, 78.6569], 7);
    window.map = map;

    // Place zoom controls at top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Dark tile layer with buffering
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        updateWhenIdle: false,
        updateWhenZooming: true,
        updateInterval: 80,
        keepBuffer: 4
    }).addTo(map);

    tileLayer.on('load', () => {
        if (skeleton) {
            skeleton.style.opacity = '0';
            setTimeout(() => { skeleton.style.display = 'none'; }, 400);
        }
    });

    map.on('moveend', updateViewportRendering);
    map.on('zoomend',  updateViewportRendering);

    // Dismiss search results on outside click
    document.addEventListener('click', e => {
        const sc = document.querySelector('.map-search-control');
        const rc = document.getElementById('mapSearchResults');
        if (rc && sc && !sc.contains(e.target)) rc.classList.add('hidden');
    });

    // GIS layer toggle button
    const toggleBtn  = document.getElementById('gisLayerToggleBtn');
    const layerCtrl  = document.querySelector('.map-floating-control');
    if (toggleBtn && layerCtrl) {
        toggleBtn.addEventListener('click', e => { e.stopPropagation(); layerCtrl.classList.toggle('show-panel'); });
        document.addEventListener('click', e => {
            if (layerCtrl.classList.contains('show-panel') && !layerCtrl.contains(e.target) && e.target !== toggleBtn) {
                layerCtrl.classList.remove('show-panel');
            }
        });
    }

    // Load GIS static data then render layers
    window.loadStaticGISData().then(async () => {

        // Load Kongu Belt towns
        try {
            const resp = await fetch('/static/data/kongu_towns.json');
            const data = await resp.json();
            konguTowns = data.kongu_towns || [];
            console.log(`[Campaign] Loaded ${konguTowns.length} Kongu Belt towns`);
        } catch(e) {
            console.warn('[Campaign] Could not load kongu_towns.json', e);
        }

        // TN boundary envelope
        L.polygon(window.tnEnvelopeCoords, {
            color: '#18A06A', weight: 1.5, fillColor: '#000000', fillOpacity: 0.02, opacity: 0.8, interactive: false
        }).addTo(map);

        window.boundaryLabels?.forEach(label => {
            L.tooltip({ permanent: true, direction: 'center', className: 'border-label' })
                .setContent(label.text).setLatLng(label.coords).addTo(map);
        });

        // ── Highways layer ────────────────────────────────────────────────────
        mapLayers.highways = L.layerGroup();
        for (const hwName in window.highwayData || {}) {
            const pts = [];
            (window.highwayData[hwName] || []).forEach(distId => {
                const d = window.allDistricts.find(x => x.id === distId);
                if (d) pts.push([d.lat, d.lng]);
            });
            if (pts.length > 1) {
                const glow = L.polyline(pts, { color: '#e67e22', weight: 6, opacity: 0.15 });
                const core = L.polyline(pts, { color: '#f39c12', weight: 2, opacity: 0.75 });
                glow.bindTooltip(`<b>${hwName}</b>`, { sticky: true });
                mapLayers.highways.addLayer(L.layerGroup([glow, core]));
            }
        }
        map.addLayer(mapLayers.highways);

        // ── Districts layer (hexagonal divIcon markers) ───────────────────────
        mapLayers.districts = L.layerGroup();
        window.allDistricts.forEach(d => {
            districtGISGroups[d.id] = L.layerGroup();
            const code = d.code || d.name.slice(0, 3).toUpperCase();

            const marker = L.marker([d.lat, d.lng], {
                icon: createDistrictHexIcon(code, false, false),
                zIndexOffset: 500
            });

            // Boundary dashed ring (30km)
            const circle = L.circle([d.lat, d.lng], {
                radius: 30000, color: '#18A06A', weight: 1, dashArray: '4 8', fill: false, interactive: false, opacity: 0.4
            });

            marker.bindPopup(getCampaignPopupHtml(d.name, `${d.name} District HQ`));
            marker.bindTooltip(`<b>${d.name} District</b>`, { direction: 'top', offset: [0, -6] });

            districtMarkers[d.id]       = marker;
            districtBoundsCircles[d.id] = circle;

            marker.on('add', () => window.updateDistrictMarkerStyle(d.id));

            marker.on('click', e => {
                L.DomEvent.stopPropagation(e);
                console.log(`[Campaign] District clicked: ${d.name} (${d.id})`);
                activateDistrictGIS(d.id);
                const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
                if (isDistrictMode) window.toggleDistrictSelection(d.id);
                else                window.toggleDistrictConstituenciesSelection(d.id);
            });
        });
        map.addLayer(mapLayers.districts);

        // ── Major cities layer ────────────────────────────────────────────────
        const renderedHqs = new Set(window.allDistricts.map(d => d.hq.toLowerCase()));
        for (const cityName in window.majorCitiesCoords || {}) {
            if (!renderedHqs.has(cityName.toLowerCase())) {
                const coords = window.majorCitiesCoords[cityName];
                const marker = L.circleMarker(coords, { radius: 3.5, fillColor: '#000', color: '#3498DB', weight: 1.5, fillOpacity: 0.8 });
                marker.bindPopup(getCampaignPopupHtml(cityName, 'Major City / Town'));
                marker.bindTooltip(`<b>${cityName}</b>`, { direction: 'top', offset: [0, -3] });
                mapLayers.districts.addLayer(marker);
            }
        }

        // ── Kongu Belt towns layer ────────────────────────────────────────────
        mapLayers.konguTowns = L.layerGroup();
        konguTowns.forEach(t => {
            const marker = L.circleMarker([t.lat, t.lng], {
                radius: 4.5, fillColor: '#9B59B6', color: '#FFFFFF', weight: 1.2, fillOpacity: 0.85
            });
            marker.bindPopup(getCampaignPopupHtml(t.name, `${t.district_id} — Kongu Belt Town`));
            marker.bindTooltip(`<b>${t.name}</b>`, { direction: 'top', offset: [0, -3] });
            marker.on('click', e => {
                L.DomEvent.stopPropagation(e);
                L.popup().setLatLng([t.lat, t.lng]).setContent(getCampaignPopupHtml(t.name, 'Kongu Belt Town')).openOn(map);
            });
            mapLayers.konguTowns.addLayer(marker);
        });
        map.addLayer(mapLayers.konguTowns);

        // ── Constituencies layer ──────────────────────────────────────────────
        window.allConstituencies.forEach(c => {
            const poly = L.polygon(getConstituencyHexagonCoords(c.lat, c.lng, 0.016), {
                color: '#18A06A', weight: 1, fillColor: '#0F7B53', fillOpacity: 0.05, opacity: 0.25
            });
            poly.isConstituency = true;

            const marker = L.circleMarker([c.lat, c.lng], { radius: 3.5, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1, fillOpacity: 0.65 });
            marker.isConstituency = true;

            const popupText = getCampaignPopupHtml(c.name, `${c.district} Assembly Constituency`);
            poly.bindPopup(popupText);
            marker.bindPopup(popupText);
            poly.bindTooltip(`${c.name} constituency`, { sticky: true });

            constituencyMarkers[c.id]  = marker;
            constituencyPolygons[c.id] = poly;

            marker.on('add', () => window.updateConstituencyMarkerStyle(c.id));
            poly.on('add',   () => window.updateConstituencyMarkerStyle(c.id));

            marker.on('mouseover', () => { if (!window.isConstituencySelected(c.id)) marker.setStyle({ radius: 5.5, fillColor: '#18A06A', weight: 2 }); });
            marker.on('mouseout',  () => { if (!window.isConstituencySelected(c.id)) marker.setStyle({ radius: 3.5, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1, fillOpacity: 0.65 }); });

            marker.on('click', e => {
                L.DomEvent.stopPropagation(e);
                const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
                if (!isDistrictMode) window.toggleConstituencySelection(c.id);
                else                 window.toggleDistrictSelection(c.district_id);
            });
            poly.on('mouseover', () => { if (!window.isConstituencySelected(c.id)) poly.setStyle({ color: '#2ECC71', weight: 2, fillOpacity: 0.15 }); });
            poly.on('mouseout',  () => { if (!window.isConstituencySelected(c.id)) poly.setStyle({ color: '#18A06A', weight: 1, fillColor: '#0F7B53', fillOpacity: 0.05, opacity: 0.25 }); });
            poly.on('click', e => {
                L.DomEvent.stopPropagation(e);
                const isDistrictMode = document.getElementById('tabInput')?.value === 'district';
                if (!isDistrictMode) window.toggleConstituencySelection(c.id);
                else                 window.toggleDistrictSelection(c.district_id);
            });
        });

        // ── Places POIs ───────────────────────────────────────────────────────
        window.combinedPlaces?.forEach(p => {
            let color = '#3498DB';
            if (p.type === 'hospital')                                          color = '#E74C3C';
            else if (['airport','railway','bus_stand','port'].includes(p.type)) color = '#F1C40F';
            else if (['government','municipality','town_panchayat'].includes(p.type)) color = '#9B59B6';

            const marker = L.circleMarker([p.lat, p.lng], { radius: 5, fillColor: color, color: '#FFFFFF', weight: 1, fillOpacity: 0.8 });
            marker.poiType = p.type;
            marker.bindPopup(getCampaignPopupHtml(p.name, p.type.replace('_', ' ') + ' POI'));
            marker.bindTooltip(p.name, { direction: 'top', offset: [0, -3] });
            if (p.district_id && districtGISGroups[p.district_id]) districtGISGroups[p.district_id].addLayer(marker);
        });

        // ── Initial state ─────────────────────────────────────────────────────
        window.switchFuelType('Petrol');

        if (window.routeStops?.length > 0) {
            await renderServerRoute();
        } else {
            updateMapSelections(false);
        }

        window.syncMarkerStylesWithCheckboxes();
        updateViewportRendering();

        console.log('[Campaign] Map initialized successfully.');
        console.log('[Campaign] Districts loaded:', window.allDistricts.length);
        console.log('[Campaign] Constituencies loaded:', window.allConstituencies.length);
        console.log('[Campaign] Kongu towns loaded:', konguTowns.length);

    }).catch(e => {
        console.error('[Campaign] Static GIS data load failed', e);
    });
};
