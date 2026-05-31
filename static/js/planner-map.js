/**
 * FuelWise Smart Planner Mapping Controller
 * Interacts with planner.html forms, handles Leaflet layers, draws routes,
 * and updates stats.
 */

// Globals specific to planner map
let map = null;
let userMarkersGroup = null;
let routePathLayers = [];
let currentRouteDistanceKm = 0;
let currentActiveDistrictId = null;
let activeMapMarkers = {};

const districtMarkers = {};
const districtBoundsCircles = {};
const districtGISGroups = {};

const mapLayers = {
    highways: null,
    districts: null
};

/**
 * Sets the loading state of the Calculate Route submit button.
 * @param {boolean} calculating 
 */
function setIsCalculating(calculating) {
    const form = document.getElementById('plannerForm');
    if (!form) return;
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;

    if (calculating) {
        button.classList.add("loading");
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Processing...';
        button.disabled = true;
        console.log("Calculation started: loading state applied.");
    } else {
        button.classList.remove("loading");
        button.innerHTML = '<i class="fa-solid fa-route mr-2"></i> Calculate Route';
        button.disabled = false;
        console.log("Loading state cleared: button reset.");
    }
}

/**
 * Custom popup html builder for drop pins.
 */
function getTripPlannerPopupHtml(name, subtitle = "", lat = null, lng = null) {
    const val = (lat !== null && lng !== null) ? `${lat},${lng}` : name;
    return `
        <div class="space-y-2">
            <div class="text-xs font-bold text-gray-100">${name}</div>
            ${subtitle ? `<div class="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">${subtitle}</div>` : ''}
            <div class="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
                <button type="button" onclick="setTripLocation('start', '${name}', '${val}'); map.closePopup();" class="px-2 py-1 bg-[#18a06a] hover:bg-[#0f7b53] text-[9px] font-bold uppercase text-white rounded transition-all">Start</button>
                <button type="button" onclick="setTripLocation('stop', '${name}', '${val}'); map.closePopup();" class="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-[9px] font-bold uppercase text-white rounded transition-all">Stop</button>
                <button type="button" onclick="setTripLocation('dest', '${name}', '${val}'); map.closePopup();" class="px-2 py-1 bg-red-600 hover:bg-red-700 text-[9px] font-bold uppercase text-white rounded transition-all">Dest</button>
            </div>
        </div>
    `;
}

/**
 * Form setters called from map click popups.
 */
window.setTripLocation = function(role, name, val) {
    const targetVal = val || name;
    if (role === 'start') {
        const originSel = document.querySelector('select[name="origin"]');
        if (originSel) {
            window.addCustomCoordinateOption(originSel, targetVal, name);
            originSel.dispatchEvent(new Event('change'));
        }
    } else if (role === 'dest') {
        const destSel = document.querySelector('select[name="destination"]');
        if (destSel) {
            window.addCustomCoordinateOption(destSel, targetVal, name);
            destSel.dispatchEvent(new Event('change'));
        }
    } else if (role === 'stop') {
        window.addStop(targetVal, name);
    }
};

/**
 * Appends a custom coordinate option to drop-downs.
 */
window.addCustomCoordinateOption = function(selectEl, val, label) {
    if (!selectEl) return;
    let exists = false;
    for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === val) {
            exists = true;
            break;
        }
    }
    if (!exists) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        selectEl.appendChild(opt);
    }
    selectEl.value = val;
};

/**
 * Builds stop selection option lists.
 */
function buildCityOptions(selectedVal) {
    return window.cities.map(c => `<option value="${c}" ${c===selectedVal?'selected':''}>` + c + '</option>').join('');
}

/**
 * Inserts dynamic intermediate stop rows.
 */
window.addStop = function(selectedVal, customLabel) {
    const container = document.getElementById('stopsContainer');
    const div = document.createElement('div');
    div.className = 'stop-row flex gap-2 items-start animate-fade-up';
    
    let optionsHtml = buildCityOptions(selectedVal||'');
    if (selectedVal && selectedVal.includes(',')) {
        optionsHtml = `<option value="${selectedVal}" selected>${customLabel || `Custom Location (${selectedVal})`}</option>` + optionsHtml;
    }
    
    div.innerHTML = `
        <div class="flex-1">
            <label class="fw-label"><i class="fa-solid fa-location-dot text-secondary mr-1"></i> Stop</label>
            <select name="stops[]" class="fw-input stop-select">
                <option value="">-- Optional Stop --</option>
                ${optionsHtml}
            </select>
        </div>
        <button type="button" onclick="removeStop(this)" class="mt-7 fw-btn fw-btn-outline px-3" style="height:48px;">
            <i class="fa-solid fa-minus text-danger"></i>
        </button>`;
    container.appendChild(div);
    
    const newSelect = div.querySelector('.stop-select');
    newSelect.addEventListener('change', () => {
        syncMapFromForm();
        if (currentRouteDistanceKm > 0) {
            window.calculateAndRoute();
        }
    });
    
    syncMapFromForm();
};

window.removeStop = function(btn) {
    btn.closest('.stop-row').remove();
    syncMapFromForm();
    if (currentRouteDistanceKm > 0) {
        window.calculateAndRoute();
    }
};

window.autoFillVehicle = function(select) {
    const vid = select.value;
    const v = window.vehicleData.find(v => v.id === vid);
    if (v) {
        document.getElementById('mileageInput').value = v.mileage || 15;
        document.getElementById('fuelType').value = v.fuel_type || 'Petrol';
        updateLabels();
        updateLiveStats();
    }
};

function updateLabels() {
    const ft = document.getElementById('fuelType').value;
    const ml = document.getElementById('mileageLabel');
    const pl = document.getElementById('priceLabel');
    const pi = document.getElementById('fuelPriceInput');
    const labels = {
        'Petrol': ['Mileage (km/L)', 'Petrol Price (/L)'],
        'Diesel': ['Mileage (km/L)', 'Diesel Price (/L)'],
        'EV': ['Range (km/charge)', 'Electricity (/kWh)'],
        'CNG': ['Mileage (km/kg)', 'CNG Price (/kg)'],
        'Hybrid': ['Mileage (km/L)', 'Fuel Price (/L)']
    };
    const prices = {
        'Petrol': window.sessionPetrolPrice,
        'Diesel': window.sessionDieselPrice,
        'EV': window.sessionEvPrice,
        'CNG': window.sessionCngPrice,
        'Hybrid': window.sessionPetrolPrice
    };
    if (ml) ml.textContent = (labels[ft] || labels['Petrol'])[0];
    if (pl) pl.textContent = (labels[ft] || labels['Petrol'])[1];
    if (pi) pi.value = prices[ft] || pi.value;
}

/**
 * Handle form inputs changes.
 */
function bindFormChangeListeners() {
    const originSel = document.querySelector('select[name="origin"]');
    const destSel = document.querySelector('select[name="destination"]');
    
    originSel?.addEventListener('change', () => {
        syncMapFromForm();
        if (currentRouteDistanceKm > 0) window.calculateAndRoute();
    });
    
    destSel?.addEventListener('change', () => {
        syncMapFromForm();
        if (currentRouteDistanceKm > 0) window.calculateAndRoute();
    });
    
    document.getElementById('mileageInput')?.addEventListener('input', updateLiveStats);
    document.getElementById('fuelPriceInput')?.addEventListener('input', updateLiveStats);
    document.getElementById('fuelType')?.addEventListener('change', () => {
        updateLabels();
        updateLiveStats();
    });
    
    const form = document.getElementById('plannerForm');
    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        window.calculateAndRoute();
    });
}

function getCoordinate(value) {
    if (!value) return null;
    if (value.includes(',')) {
        const parts = value.split(',');
        return [parseFloat(parts[0]), parseFloat(parts[1])];
    }
    return window.locationCoords[value] || null;
}

/**
 * Sync form selections with pins on the map without duplicate recreations.
 */
function syncMapFromForm() {
    if (!map) return;
    
    if (!userMarkersGroup) {
        userMarkersGroup = L.layerGroup().addTo(map);
    }
    
    const originVal = document.querySelector('select[name="origin"]')?.value || "";
    const destVal = document.querySelector('select[name="destination"]')?.value || "";
    const stopSelects = document.querySelectorAll('select[name="stops[]"]');
    
    const newActiveMarkers = {};
    const fitBoundsCoords = [];
    
    // Helper to get, update or create marker
    function getOrCreateMarker(key, coords, color, letter, popupName, popupSubtitle, role, selectEl) {
        let marker = activeMapMarkers[key];
        fitBoundsCoords.push(coords);
        
        if (marker) {
            // Update coordinates and content instead of recreating
            marker.setLatLng(coords);
            marker.setIcon(createCustomPin(color, letter));
            marker.setPopupContent(getTripPlannerPopupHtml(popupName, popupSubtitle, coords[0], coords[1]));
            newActiveMarkers[key] = marker;
            delete activeMapMarkers[key];
        } else {
            // Create new marker
            const pinIcon = createCustomPin(color, letter);
            marker = L.marker(coords, { icon: pinIcon, draggable: true }).addTo(userMarkersGroup);
            marker.bindPopup(getTripPlannerPopupHtml(popupName, popupSubtitle, coords[0], coords[1]));
            
            marker.on('dragend', function(e) {
                const newLatLng = e.target.getLatLng();
                const val = `${newLatLng.lat.toFixed(6)},${newLatLng.lng.toFixed(6)}`;
                const snapped = findNearestLocation(newLatLng);
                const label = snapped && snapped.distance < 35000 ? `Custom Location (near ${snapped.name})` : `Location (${newLatLng.lat.toFixed(4)}, ${newLatLng.lng.toFixed(4)})`;
                
                if (role === 'origin') {
                    window.addCustomCoordinateOption(selectEl, val, label);
                } else if (role === 'destination') {
                    window.addCustomCoordinateOption(selectEl, val, label);
                } else if (role === 'stop') {
                    window.addCustomCoordinateOption(selectEl, val, label);
                }
                
                syncMapFromForm();
                if (currentRouteDistanceKm > 0) {
                    window.calculateAndRoute();
                }
            });
            
            newActiveMarkers[key] = marker;
        }
    }
    
    // 1. Origin
    if (originVal) {
        const coords = getCoordinate(originVal);
        if (coords) {
            const originSel = document.querySelector('select[name="origin"]');
            getOrCreateMarker('origin', coords, '#2ECC71', 'A', originVal, "Start Point", 'origin', originSel);
        }
    }
    
    // 2. Stops
    stopSelects.forEach((sel, idx) => {
        const val = sel.value;
        if (val) {
            const coords = getCoordinate(val);
            if (coords) {
                const letter = String.fromCharCode(67 + idx);
                getOrCreateMarker(`stop_${idx}`, coords, '#3498DB', letter, val, `Stop #${idx + 1}`, 'stop', sel);
            }
        }
    });
    
    // 3. Destination
    if (destVal) {
        const coords = getCoordinate(destVal);
        if (coords) {
            const destSel = document.querySelector('select[name="destination"]');
            getOrCreateMarker('destination', coords, '#E74C3C', 'B', destVal, "Destination", 'destination', destSel);
        }
    }
    
    // Clean up markers that are no longer active
    for (let key in activeMapMarkers) {
        userMarkersGroup.removeLayer(activeMapMarkers[key]);
    }
    
    activeMapMarkers = newActiveMarkers;
    
    if (fitBoundsCoords.length > 0 && routePathLayers.length === 0) {
        try {
            const bounds = L.latLngBounds(fitBoundsCoords);
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12, animate: true, duration: 0.8 });
        } catch(e) {
            console.error("Failed to fit bounds", e);
        }
    }
}


/**
 * Handle direct map canvas click pin drop.
 */
function handleMapClick(e) {
    if (e.originalEvent && e.originalEvent.defaultPrevented) return;
    
    const latlng = e.latlng;
    const lat = latlng.lat;
    const lng = latlng.lng;
    
    const snapped = findNearestLocation(latlng);
    const label = snapped && snapped.distance < 35000 ? `Custom Location (near ${snapped.name})` : `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    const val = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    
    const originSel = document.querySelector('select[name="origin"]');
    const destSel = document.querySelector('select[name="destination"]');
    
    if (!originSel.value) {
        window.addCustomCoordinateOption(originSel, val, label);
        syncMapFromForm();
        L.popup()
            .setLatLng(latlng)
            .setContent(`<div class="p-1 text-center"><b class="text-primary">Start Location Set</b><br>${label}</div>`)
            .openOn(map);
    } else if (!destSel.value) {
        window.addCustomCoordinateOption(destSel, val, label);
        syncMapFromForm();
        L.popup()
            .setLatLng(latlng)
            .setContent(`<div class="p-1 text-center"><b class="text-danger">Destination Set</b><br>${label}</div>`)
            .openOn(map);
    } else {
        window.addStop(val, label);
        L.popup()
            .setLatLng(latlng)
            .setContent(`<div class="p-1 text-center"><b class="text-secondary">Intermediate Stop Added</b><br>${label}</div>`)
            .openOn(map);
    }
}

/**
 * Client side nearest-neighbor solver for stops.
 */
function optimizeStopsClientSide(names, coords) {
    if (names.length <= 3) return { names, coords };
    
    const startName = names[0];
    const startCoord = coords[0];
    const destName = names[names.length - 1];
    const destCoord = coords[coords.length - 1];
    
    const intermediateNames = names.slice(1, -1);
    const intermediateCoords = coords.slice(1, -1);
    
    const optimizedNames = [startName];
    const optimizedCoords = [startCoord];
    
    let currentCoord = startCoord;
    const unvisitedIndices = Array.from({ length: intermediateNames.length }, (_, i) => i);
    
    while (unvisitedIndices.length > 0) {
        let nearestIndex = -1;
        let minDistance = Infinity;
        
        for (let i = 0; i < unvisitedIndices.length; i++) {
            const idx = unvisitedIndices[i];
            const coord = intermediateCoords[idx];
            const dist = L.latLng(currentCoord[0], currentCoord[1]).distanceTo(L.latLng(coord[0], coord[1]));
            
            if (dist < minDistance) {
                minDistance = dist;
                nearestIndex = idx;
            }
        }
        
        const nextIdx = nearestIndex;
        optimizedNames.push(intermediateNames[nextIdx]);
        optimizedCoords.push(intermediateCoords[nextIdx]);
        currentCoord = intermediateCoords[nextIdx];
        
        unvisitedIndices.splice(unvisitedIndices.indexOf(nextIdx), 1);
    }
    
    optimizedNames.push(destName);
    optimizedCoords.push(destCoord);
    
    return { names: optimizedNames, coords: optimizedCoords };
}

function reorderFormSelects(finalNames) {
    const originSel = document.querySelector('select[name="origin"]');
    const destSel = document.querySelector('select[name="destination"]');
    
    if (originSel) {
        window.addCustomCoordinateOption(originSel, finalNames[0], finalNames[0]);
        originSel.value = finalNames[0];
    }
    if (destSel) {
        window.addCustomCoordinateOption(destSel, finalNames[finalNames.length - 1], finalNames[finalNames.length - 1]);
        destSel.value = finalNames[finalNames.length - 1];
    }
    
    const container = document.getElementById('stopsContainer');
    if (container) container.innerHTML = "";
    
    const stops = finalNames.slice(1, -1);
    stops.forEach(stopName => {
        window.addStop(stopName, stopName);
    });
}

/**
 * Draws the finalized routing path on map.
 */
function drawRoutePath(geometry, coordsList, namesList, source) {
    // Clear old route polylines
    if (routePathLayers.length > 0) {
        routePathLayers.forEach(layer => map.removeLayer(layer));
        routePathLayers = [];
    }
    
    // Draw route polylines
    const outerGlow = L.geoJSON(geometry, {
        style: { color: '#0F7B53', weight: 8, opacity: 0.35 }
    }).addTo(map);
    
    const innerCore = L.geoJSON(geometry, {
        style: { color: '#2ECC71', weight: 4, opacity: 0.95 }
    }).addTo(map);
    
    routePathLayers.push(outerGlow, innerCore);
    
    // Update active markers popup to show the routing source path info
    coordsList.forEach((coord, idx) => {
        const isStart = idx === 0;
        const isEnd = idx === coordsList.length - 1;
        const name = namesList[idx];
        
        let key = '';
        let subtitle = '';
        if (isStart) {
            key = 'origin';
            subtitle = `Start Location (${source} path)`;
        } else if (isEnd) {
            key = 'destination';
            subtitle = `Destination (${source} path)`;
        } else {
            key = `stop_${idx - 1}`;
            subtitle = `Stop #${idx} (${source} path)`;
        }
        
        const marker = activeMapMarkers[key];
        if (marker) {
            marker.setPopupContent(getTripPlannerPopupHtml(name, subtitle, coord[0], coord[1]));
        }
    });
    
    try {
        const bounds = outerGlow.getBounds();
        map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 0.8 });
    } catch(e) {
        console.error("Failed to fit bounds", e);
    }
}


function updateRouteStatsUI(distanceKm, durationHours, stopCount) {
    const valDistance = document.getElementById('valDistance');
    const valTime = document.getElementById('valTime');
    const valStops = document.getElementById('valStops');
    const optimizedBadge = document.getElementById('optimizedBadge');
    const optimizeChecked = document.getElementById('optimizeToggle')?.checked || false;
    
    if (valDistance) valDistance.textContent = distanceKm.toFixed(1);
    if (valTime) valTime.textContent = durationHours.toFixed(1);
    if (valStops) valStops.textContent = stopCount;
    
    if (optimizedBadge) {
        if (optimizeChecked) optimizedBadge.classList.remove('hidden');
        else optimizedBadge.classList.add('hidden');
    }
    
    updateLiveStats();
}

function updateLiveStats() {
    if (currentRouteDistanceKm <= 0) return;
    
    const mileage = parseFloat(document.getElementById('mileageInput').value) || 15;
    const fuelPrice = parseFloat(document.getElementById('fuelPriceInput').value) || 100;
    const fuelType = document.getElementById('fuelType').value;
    
    const fuelNeeded = currentRouteDistanceKm / mileage;
    const totalCost = fuelNeeded * fuelPrice;
    
    const co2Factors = { 'Petrol': 2.31, 'Diesel': 2.68, 'CNG': 2.0, 'EV': 0.0, 'Hybrid': 1.5 };
    const co2 = fuelNeeded * (co2Factors[fuelType] || 2.31);
    
    const valFuel = document.getElementById('valFuel');
    const valFuelType = document.getElementById('valFuelType');
    const valCost = document.getElementById('valCost');
    const valCO2 = document.getElementById('valCO2');
    
    if (valFuel) valFuel.textContent = fuelNeeded.toFixed(2);
    if (valFuelType) valFuelType.textContent = fuelType;
    if (valCost) valCost.textContent = '₹' + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    if (valCO2) valCO2.textContent = co2.toFixed(2);
    
    const previewFuel = document.getElementById('previewFuel');
    const previewCost = document.getElementById('previewCost');
    if (previewFuel) previewFuel.textContent = fuelNeeded.toFixed(2) + ' L';
    if (previewCost) previewCost.textContent = '₹' + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function showMapRoutePreviewCard(distanceKm, durationHours) {
    const previewCard = document.getElementById('mapRoutePreview');
    const previewDistance = document.getElementById('previewDistance');
    const previewDuration = document.getElementById('previewDuration');
    
    if (previewCard) previewCard.classList.remove('hidden');
    if (previewDistance) previewDistance.textContent = distanceKm.toFixed(1) + ' km';
    if (previewDuration) previewDuration.textContent = durationHours.toFixed(1) + ' hrs';
    
    updateLiveStats();
}

window.toggleRoutePreview = function() {
    const previewCard = document.getElementById('mapRoutePreview');
    if (previewCard) previewCard.classList.add('hidden');
};

function renderRouteTimeline(segments, stops) {
    const listContainer = document.getElementById('routeTimelineList');
    if (!listContainer) return;
    
    let html = "";
    segments.forEach((seg, idx) => {
        const estDuration = (seg.distance / 50.0).toFixed(1);
        const estFuel = (seg.distance / 15.0).toFixed(1);
        
        html += `
            <div class="border border-gray-100 dark:border-white/5 rounded-xl overflow-hidden bg-gray-50 dark:bg-white/5 animate-fade-up">
                <details class="group">
                    <summary class="flex items-center justify-between py-3 px-4 font-semibold text-sm cursor-pointer select-none">
                        <div class="flex items-center gap-3">
                            <div class="w-6 h-6 rounded-full ${idx === 0 ? 'bg-primary' : 'bg-secondary/80'} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                                ${idx + 1}
                            </div>
                            <span class="truncate max-w-[120px] sm:max-w-[200px]">${seg.from}</span>
                            <i class="fa-solid fa-arrow-right text-primary text-xs flex-shrink-0"></i>
                            <span class="truncate max-w-[120px] sm:max-w-[200px]">${seg.to}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-primary">${seg.distance} km</span>
                            <i class="fa-solid fa-chevron-down text-[10px] text-gray-400 transition-transform group-open:rotate-180"></i>
                        </div>
                    </summary>
                    <div class="px-4 pb-3 pt-1 border-t border-gray-100 dark:border-white/5 text-xs text-gray-500 dark:text-gray-400 space-y-2">
                        <div class="flex justify-between">
                            <span>Segment Distance:</span>
                            <span class="font-bold text-gray-800 dark:text-gray-200">${seg.distance} km</span>
                        </div>
                        <div class="flex justify-between">
                            <span>Est. Drive Time:</span>
                            <span class="font-bold text-gray-800 dark:text-gray-200">${estDuration} hrs</span>
                        </div>
                        <div class="flex justify-between">
                            <span>Est. Fuel Consumed:</span>
                            <span class="font-bold text-gray-800 dark:text-gray-200">${estFuel} L</span>
                        </div>
                    </div>
                </details>
            </div>
        `;
    });
    
    if (stops.length > 1) {
        const destName = stops[stops.length - 1];
        html += `
            <div class="flex items-center gap-3 py-3 px-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 animate-fade-up">
                <div class="w-6 h-6 rounded-full bg-danger flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    <i class="fa-solid fa-map-pin"></i>
                </div>
                <span class="font-semibold text-sm truncate">${destName}</span>
                <span class="ml-auto text-xs text-success font-bold">Destination</span>
            </div>
        `;
    }
    
    listContainer.innerHTML = html;
}

/**
 * Main calculation logic. Calls routingProvider.
 */
window.calculateAndRoute = async function() {
    const originSel = document.querySelector('select[name="origin"]');
    const destSel = document.querySelector('select[name="destination"]');
    
    if (!originSel || !destSel) return;
    
    const originVal = originSel.value;
    const destVal = destSel.value;
    
    if (!originVal || !destVal) {
        alert("Please select both a Start Location and a Destination.");
        return;
    }
    
    const stopSelects = document.querySelectorAll('select[name="stops[]"]');
    const stopVals = Array.from(stopSelects).map(sel => sel.value).filter(val => val !== "");
    const optimizeChecked = document.getElementById('optimizeToggle')?.checked || false;
    
    let namesList = [originVal, ...stopVals, destVal];
    let coordsList = namesList.map(name => getCoordinate(name)).filter(c => !!c);
    
    if (coordsList.length < 2) {
        alert("Could not locate coordinates for selected locations.");
        return;
    }
    
    // Set loading state and log start
    setIsCalculating(true);
    console.log("Calculation started");
    
    const skeleton = document.getElementById('mapSkeleton');
    if (skeleton) {
        const textEl = skeleton.querySelector('.animate-pulse');
        if (textEl) textEl.textContent = "Resolving Optimal Road Route...";
        skeleton.style.display = 'flex';
        skeleton.style.opacity = '1';
    }
    
    try {
        let finalNames = [...namesList];
        let finalCoords = [...coordsList];
        
        if (optimizeChecked && coordsList.length > 3) {
            const opt = optimizeStopsClientSide(namesList, coordsList);
            finalNames = opt.names;
            finalCoords = opt.coords;
            reorderFormSelects(finalNames);
        }
        
        // Resolve route via routingProvider (resilient fallback handler)
        const routeData = await window.routingProvider.resolveRoute(finalNames, finalCoords, false);
        console.log("Route received", routeData);
        
        currentRouteDistanceKm = routeData.distance;
        
        drawRoutePath(routeData.geometry, finalCoords, finalNames, routeData.source);
        updateRouteStatsUI(routeData.distance, routeData.duration, finalNames.length - 2);
        
        const segments = [];
        for (let i = 0; i < finalCoords.length - 1; i++) {
            const segDist = routeData.legs[i] || (routeData.distance / (finalCoords.length - 1));
            segments.push({
                from: finalNames[i],
                to: finalNames[i+1],
                distance: parseFloat(segDist.toFixed(1))
            });
        }
        
        renderRouteTimeline(segments, finalNames);
        
        const resultsContainer = document.getElementById('routeResultsContainer');
        if (resultsContainer) resultsContainer.classList.remove('hidden');
        
        showMapRoutePreviewCard(routeData.distance, routeData.duration);
        console.log("Results displayed");
        
    } catch(e) {
        console.error(e);
        alert("Failed to calculate route path. Operating offline fallbacks failed.");
    } finally {
        if (skeleton) {
            skeleton.style.opacity = '0';
            setTimeout(() => { skeleton.style.display = 'none'; }, 500);
        }
        setIsCalculating(false);
        console.log("Loading state cleared");
    }
};


window.clearMapPins = function() {
    const originSel = document.querySelector('select[name="origin"]');
    const destSel = document.querySelector('select[name="destination"]');
    if (originSel) originSel.value = "";
    if (destSel) destSel.value = "";
    
    const container = document.getElementById('stopsContainer');
    if (container) container.innerHTML = "";
    
    if (routePathLayers.length > 0) {
        routePathLayers.forEach(layer => map.removeLayer(layer));
        routePathLayers = [];
    }
    currentRouteDistanceKm = 0;
    
    if (userMarkersGroup) {
        map.removeLayer(userMarkersGroup);
        userMarkersGroup = null;
    }
    
    const resultsContainer = document.getElementById('routeResultsContainer');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    
    window.toggleRoutePreview();
    
    const searchInput = document.getElementById('mapSearchInput');
    if (searchInput) searchInput.value = "";
    
    if (map) map.closePopup();
    window.resetMapZoom();
};

window.resetMapZoom = function() {
    if (!map) return;
    map.flyTo([11.1271, 78.6569], 7, { animate: true, duration: 0.8 });
    map.closePopup();
    deactivateActiveDistrictGIS();
    updateViewportRendering();
};

window.toggleMapLayer = function(layerName) {
    if (layerName === 'highways') {
        const cb = document.getElementById('layerHighways');
        if (cb && cb.checked) map.addLayer(mapLayers.highways);
        else map.removeLayer(mapLayers.highways);
    } else {
        updateViewportRendering();
    }
};

function updateViewportRendering() {
    if (!map) return;
    const bounds = map.getBounds();
    
    for (let distId in districtMarkers) {
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
    
    if (currentActiveDistrictId && districtGISGroups[currentActiveDistrictId]) {
        const group = districtGISGroups[currentActiveDistrictId];
        group.eachLayer(layer => {
            let inViewport = false;
            if (layer.getLatLng) inViewport = bounds.contains(layer.getLatLng());
            else if (layer.getBounds) inViewport = bounds.intersects(layer.getBounds());
            
            let categoryEnabled = true;
            if (layer.poiType) {
                const categoryMap = {
                    'government': 'government', 'municipality': 'government', 'town_panchayat': 'government',
                    'bus_stand': 'transport', 'railway': 'transport', 'airport': 'transport', 'port': 'transport',
                    'hospital': 'hospitals', 'temple': 'temples', 'tourist': 'temples', 'college': 'temples'
                };
                const mappedCategory = categoryMap[layer.poiType] || 'temples';
                const cb = document.getElementById('layer' + mappedCategory.charAt(0).toUpperCase() + mappedCategory.slice(1));
                categoryEnabled = cb ? cb.checked : true;
            } else if (layer.isConstituency) {
                const cb = document.getElementById('layerConstituencies');
                categoryEnabled = cb ? cb.checked : true;
            }
            
            if (inViewport && categoryEnabled) {
                if (!map.hasLayer(layer)) map.addLayer(layer);
            } else {
                if (map.hasLayer(layer)) map.removeLayer(layer);
            }
        });
    }
}

function activateDistrictGISQuiet(distId) {
    if (currentActiveDistrictId && currentActiveDistrictId !== distId) {
        const prevGroup = districtGISGroups[currentActiveDistrictId];
        if (prevGroup) {
            prevGroup.eachLayer(layer => {
                if (map.hasLayer(layer)) map.removeLayer(layer);
            });
        }
    }
    currentActiveDistrictId = distId;
}

function activateDistrictGIS(distId) {
    if (!distId || !map) return;
    const d = window.allDistricts.find(item => String(item.id) === String(distId));
    if (!d) return;
    
    map.flyTo([d.lat, d.lng], 10, { animate: true, duration: 0.8 });
    activateDistrictGISQuiet(distId);
    
    const hqMarker = districtMarkers[distId];
    if (hqMarker) {
        hqMarker.bindPopup(`
            <div class="space-y-1.5 p-0.5">
                <div class="text-xs font-black text-primary">${d.name} District</div>
                <div class="text-[9px] text-gray-400 font-bold">Headquarters: ${d.hq}</div>
            </div>
        `).openPopup();
    }
    updateViewportRendering();
}

function deactivateActiveDistrictGIS() {
    if (currentActiveDistrictId) {
        const prevGroup = districtGISGroups[currentActiveDistrictId];
        if (prevGroup) {
            prevGroup.eachLayer(layer => {
                if (map.hasLayer(layer)) map.removeLayer(layer);
            });
        }
        currentActiveDistrictId = null;
    }
}

window.handleMapSearch = function(val) {
    const resultsContainer = document.getElementById('mapSearchResults');
    if (!resultsContainer) return;
    
    const query = val.trim().toLowerCase();
    if (query.length < 2) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
        return;
    }
    
    const matches = [];
    
    window.allDistricts.forEach(d => {
        if (d.name.toLowerCase().includes(query) || d.hq.toLowerCase().includes(query)) {
            matches.push({ name: d.name, type: 'District', id: d.id, lat: d.lat, lng: d.lng });
        }
    });
    
    window.allConstituencies.forEach(c => {
        if (c.name.toLowerCase().includes(query)) {
            matches.push({ name: c.name, type: 'Constituency', id: c.id, districtId: c.district_id, lat: c.lat, lng: c.lng });
        }
    });
    
    for (let city in window.majorCitiesCoords) {
        if (city.toLowerCase().includes(query)) {
            if (!matches.some(m => m.name.toLowerCase() === city.toLowerCase())) {
                const coords = window.majorCitiesCoords[city];
                matches.push({ name: city, type: 'City', lat: coords[0], lng: coords[1] });
            }
        }
    }
    
    window.combinedPlaces.forEach(p => {
        if (p.name.toLowerCase().includes(query)) {
            matches.push({ name: p.name, type: p.type.toUpperCase().replace('_', ' '), lat: p.lat, lng: p.lng });
        }
    });
    
    const limitedMatches = matches.slice(0, 6);
    if (limitedMatches.length === 0) {
        resultsContainer.innerHTML = `<div class="p-2.5 text-center text-xs text-gray-500">No results found</div>`;
        resultsContainer.classList.remove('hidden');
        return;
    }
    
    let html = '';
    limitedMatches.forEach(item => {
        html += `
            <div class="search-result-item" onclick="selectSearchResult(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                <span class="font-semibold">${item.name}</span>
                <span class="search-result-type">${item.type}</span>
            </div>
        `;
    });
    resultsContainer.innerHTML = html;
    resultsContainer.classList.remove('hidden');
};

window.selectSearchResult = function(item) {
    const input = document.getElementById('mapSearchInput');
    if (input) input.value = item.name;
    
    const resultsContainer = document.getElementById('mapSearchResults');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
    }
    
    if (map) {
        map.flyTo([item.lat, item.lng], 12, { animate: true, duration: 0.8 });
        if (item.type === 'District') activateDistrictGIS(item.id);
        else if (item.districtId) activateDistrictGIS(item.districtId);
        else {
            const closestDist = findClosestDistrict(item.lat, item.lng);
            if (closestDist) activateDistrictGIS(closestDist.id);
        }
        
        L.popup()
            .setLatLng([item.lat, item.lng])
            .setContent(getTripPlannerPopupHtml(item.name, item.type))
            .openOn(map);
    }
};

/**
 * Initializes the smart planner map interface.
 */
window.initPlannerMap = async function() {
    const skeleton = document.getElementById('mapSkeleton');
    if (skeleton) {
        skeleton.style.display = 'flex';
        skeleton.style.opacity = '1';
    }

    try {
        // Step 1: Load Leaflet JS & CSS resources immediately
        await window.lazyLoadMapResources();
    } catch(e) {
        console.error("Leaflet resources load failed", e);
        if (skeleton) {
            skeleton.style.display = 'none';
        }
        return;
    }
    
    // Step 2: Set up Leaflet Map object instantly with smooth animations and inertia
    map = L.map('plannerMap', {
        zoomControl: true,
        attributionControl: false,
        zoomAnimation: true,
        markerZoomAnimation: true,
        fadeAnimation: true,
        inertia: true,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: 1500,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        wheelDebounceTime: 40,
        wheelPxPerZoomLevel: 120,
        doubleClickZoom: true,
        tap: !L.Browser.mobile
    }).setView([11.1271, 78.6569], 7);
    window.map = map;
    
    // Optimized TileLayer for fast preloading & buffer caching to prevent white flashes
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
        updateWhenIdle: false,
        updateWhenZooming: true,
        updateInterval: 100,
        keepBuffer: 3
    });
    tileLayer.addTo(map);
    
    // Defer skeleton hide until tiles start rendering
    tileLayer.on('load', () => {
        if (skeleton) {
            skeleton.style.opacity = '0';
            setTimeout(() => { skeleton.style.display = 'none'; }, 500);
        }
    });
    
    map.on('click', handleMapClick);
    map.on('moveend', updateViewportRendering);
    map.on('zoomend', updateViewportRendering);
    
    // Dismiss autocomplete dropdown on click outside
    document.addEventListener('click', (e) => {
        const searchControl = document.querySelector('.map-search-control');
        const resultsContainer = document.getElementById('mapSearchResults');
        if (resultsContainer && searchControl && !searchControl.contains(e.target)) {
            resultsContainer.classList.add('hidden');
        }
    });
    
    // Step 3: Load GIS static database files asynchronously in background
    window.loadStaticGISData().then(async () => {
        // Render Tamil Nadu Boundary envelope
        L.polygon(window.tnEnvelopeCoords, {
            color: '#18A06A', weight: 1.5, fillColor: '#000000', fillOpacity: 0.02, opacity: 0.8, interactive: false
        }).addTo(map);
        
        window.boundaryLabels.forEach(label => {
            L.tooltip({ permanent: true, direction: 'center', className: 'border-label' })
            .setContent(label.text)
            .setLatLng(label.coords)
            .addTo(map);
        });
        
        // Generate Highways layer
        mapLayers.highways = L.layerGroup();
        for (let hwName in window.highwayData) {
            const routePoints = [];
            window.highwayData[hwName].forEach(distId => {
                const distObj = window.allDistricts.find(d => d.id === distId);
                if (distObj) routePoints.push([distObj.lat, distObj.lng]);
            });
            
            if (routePoints.length > 1) {
                const glowLine = L.polyline(routePoints, { color: '#e67e22', weight: 6, opacity: 0.15 });
                const coreLine = L.polyline(routePoints, { color: '#f39c12', weight: 2, opacity: 0.75 });
                const highwayG = L.layerGroup([glowLine, coreLine]);
                glowLine.bindTooltip(`<b>${hwName}</b>`, { sticky: true });
                mapLayers.highways.addLayer(highwayG);
            }
        }
        map.addLayer(mapLayers.highways);
        
        // Setup districts layer
        mapLayers.districts = L.layerGroup();
        window.allDistricts.forEach(d => {
            districtGISGroups[d.id] = L.layerGroup();
            const marker = L.circleMarker([d.lat, d.lng], { radius: 5, fillColor: '#000000', color: '#18A06A', weight: 1.5, fillOpacity: 0.9 });
            const circle = L.circle([d.lat, d.lng], { radius: 25000, color: '#18A06A', weight: 1, dashArray: '3 5', fill: false, interactive: false });
            
            marker.bindPopup(getTripPlannerPopupHtml(d.hq, `District HQ of ${d.name}`));
            marker.bindTooltip(`<b>${d.name}</b>`, { direction: 'top', offset: [0, -4] });
            
            districtMarkers[d.id] = marker;
            districtBoundsCircles[d.id] = circle;
            
            marker.on('click', () => { activateDistrictGIS(d.id); });
        });
        map.addLayer(mapLayers.districts);
        
        // Add other major cities/towns
        const renderedHqs = new Set(window.allDistricts.map(d => d.hq.toLowerCase()));
        for (let cityName in window.majorCitiesCoords) {
            if (!renderedHqs.has(cityName.toLowerCase())) {
                const coords = window.majorCitiesCoords[cityName];
                const marker = L.circleMarker(coords, { radius: 4, fillColor: '#000000', color: '#3498DB', weight: 1.5, fillOpacity: 0.8 });
                marker.bindPopup(getTripPlannerPopupHtml(cityName, `Major City / Town`));
                marker.bindTooltip(`<b>${cityName}</b>`, { direction: 'top', offset: [0, -3] });
                mapLayers.districts.addLayer(marker);
            }
        }
        
        // Process assembly constituencies
        window.allConstituencies.forEach(c => {
            const polyCoords = getConstituencyHexagonCoords(c.lat, c.lng, 0.016);
            const poly = L.polygon(polyCoords, { color: '#18A06A', weight: 1, fillColor: '#0F7B53', fillOpacity: 0.05, opacity: 0.25 });
            poly.isConstituency = true;
            
            const marker = L.circleMarker([c.lat, c.lng], { radius: 3.5, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1, fillOpacity: 0.65 });
            marker.isConstituency = true;
            
            const popupText = getTripPlannerPopupHtml(c.name, `${c.district} Assembly constituency`);
            poly.bindPopup(popupText);
            marker.bindPopup(popupText);
            poly.bindTooltip(`${c.name} Constituency`, { sticky: true });
            
            const cGroup = L.layerGroup([poly, marker]);
            if (districtGISGroups[c.district_id]) districtGISGroups[c.district_id].addLayer(cGroup);
        });
        
        // Process places POIs
        window.combinedPlaces.forEach(p => {
            let color = '#3498DB';
            if (p.type === 'hospital') color = '#E74C3C';
            else if (['airport', 'railway', 'bus_stand', 'port'].includes(p.type)) color = '#F1C40F';
            else if (['government', 'municipality', 'town_panchayat'].includes(p.type)) color = '#9B59B6';
            
            const marker = L.circleMarker([p.lat, p.lng], { radius: 5, fillColor: color, color: '#FFFFFF', weight: 1, fillOpacity: 0.8 });
            marker.poiType = p.type;
            marker.bindPopup(getTripPlannerPopupHtml(p.name, `${p.type.replace('_', ' ')} POI`));
            marker.bindTooltip(p.name, { direction: 'top', offset: [0, -3] });
            
            if (p.district_id && districtGISGroups[p.district_id]) districtGISGroups[p.district_id].addLayer(marker);
        });
        
        // Render initial prefilled route if exists
        if (window.routeStops && window.routeStops.length >= 2) {
            const coordsList = window.routeStops.map(name => getCoordinate(name)).filter(c => !!c);
            if (coordsList.length >= 2) {
                try {
                    const routeData = await window.routingProvider.resolveRoute(window.routeStops, coordsList, false);
                    currentRouteDistanceKm = routeData.distance;
                    drawRoutePath(routeData.geometry, coordsList, window.routeStops, routeData.source);
                    
                    const segments = [];
                    for (let i = 0; i < coordsList.length - 1; i++) {
                        const segDist = routeData.legs[i] || (currentRouteDistanceKm / (coordsList.length - 1));
                        segments.push({
                            from: window.routeStops[i],
                            to: window.routeStops[i+1],
                            distance: parseFloat(segDist.toFixed(1))
                        });
                    }
                    renderRouteTimeline(segments, window.routeStops);
                    
                    const resultsContainer = document.getElementById('routeResultsContainer');
                    if (resultsContainer) resultsContainer.classList.remove('hidden');
                    
                    showMapRoutePreviewCard(currentRouteDistanceKm, routeData.duration);
                } catch(e) {
                    console.error("Failed to load initial OSRM route", e);
                }
            }
        }
        
        bindFormChangeListeners();
        syncMapFromForm();
        updateLabels();
        
        // Collapsible GIS Layer Toggle for mobile/tablet screens
        const toggleBtn = document.getElementById('gisLayerToggleBtn');
        const layerControl = document.querySelector('.map-floating-control');
        if (toggleBtn && layerControl) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                layerControl.classList.toggle('show-panel');
            });
            document.addEventListener('click', (e) => {
                if (layerControl.classList.contains('show-panel') && !layerControl.contains(e.target) && e.target !== toggleBtn) {
                    layerControl.classList.remove('show-panel');
                }
            });
        }
        
        updateViewportRendering();
    }).catch(e => {
        console.error("Background static GIS load failed", e);
    });
};

window.locateUser = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.flyTo([lat, lng], 13);
            
            // Drop a temporary pulse marker
            const locateMarker = L.circleMarker([lat, lng], {
                radius: 8,
                fillColor: '#22C55E',
                color: '#ffffff',
                weight: 2,
                fillOpacity: 0.8
            }).addTo(map);
            locateMarker.bindPopup("<b>You are here</b>").openPopup();
        }, (err) => {
            console.warn("Geolocation permission denied or failed", err);
            // Flash a generic toast notice
            const container = document.getElementById('toastContainer');
            if (container) {
                const toast = document.createElement('div');
                toast.className = 'fw-toast error';
                toast.innerHTML = '<i class="fa-solid fa-circle-xmark"></i><span>Location access denied or unavailable.</span>';
                container.appendChild(toast);
                setTimeout(() => {
                    toast.style.transform = "translateX(120%)";
                    toast.style.opacity = "0";
                    setTimeout(() => toast.remove(), 400);
                }, 4000);
            }
        });
    } else {
        alert("Geolocation is not supported by your browser.");
    }
};

