/**
 * FuelWise Campaign Planner Mapping Controller
 * Interacts with campaign.html forms, accordion selection, parameters switcher,
 * Leaflet layers, and OSRM route calculations.
 */

// Globals specific to campaign map
let map = null;
let liveRouteGroup = null;
let serverRouteGroup = null;
let currentActiveDistrictId = null;

const districtMarkers = {};
const districtBoundsCircles = {};
const constituencyMarkers = {};
const constituencyPolygons = {};
const districtGISGroups = {};

const mapLayers = {
    highways: null,
    districts: null,
    constituencies: null,
    government: null,
    transport: null,
    hospitals: null,
    temples: null
};

/**
 * Custom popup HTML builder for Campaign planner.
 */
function getCampaignPopupHtml(name, subtitle = "", lat = null, lng = null) {
    const val = (lat !== null && lng !== null) ? `${lat},${lng}` : name;
    return `
        <div class="space-y-2">
            <div class="text-xs font-bold text-gray-100">${name}</div>
            ${subtitle ? `<div class="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">${subtitle}</div>` : ''}
            <div class="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
                <button type="button" onclick="toggleCampaignStop('${name}', true)" class="px-2 py-1 bg-[#18a06a] hover:bg-[#0f7b53] text-[9px] font-bold uppercase text-white rounded transition-all">Add Stop</button>
            </div>
        </div>
    `;
}

/**
 * Custom pin creator for Campaign planner.
 */
function createCustomPin(color, letter = "") {
    const svgHtml = `
        <svg width="24" height="24" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 2A11 11 0 0 0 5 13c0 7.25 9.8 17.2 10.4 17.8a0.8 0.8 0 0 0 1.2 0c0.6-.6 10.4-10.55 10.4-17.8A11 11 0 0 0 16 2z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
            <circle cx="16" cy="13" r="4" fill="#ffffff"/>
            ${letter ? `<text x="16" y="24" font-size="9" font-weight="900" fill="#ffffff" text-anchor="middle">${letter}</text>` : ''}
        </svg>
    `;
    return L.divIcon({
        html: svgHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24],
        className: 'custom-pin-marker'
    });
}

function getCampaignCoordinate(stopName) {
    if (!stopName) return null;
    if (typeof stopName === 'string' && stopName.includes(',')) {
        const parts = stopName.split(',');
        return [parseFloat(parts[0]), parseFloat(parts[1])];
    }
    const d = window.allDistricts.find(item => item.name.toLowerCase() === stopName.toLowerCase() || item.hq.toLowerCase() === stopName.toLowerCase());
    if (d) return [d.lat, d.lng];
    const c = window.allConstituencies.find(item => item.name.toLowerCase() === stopName.toLowerCase());
    if (c) return [c.lat, c.lng];
    return null;
}

window.toggleCampaignStop = function(name, add) {
    if (!name) return;
    const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
    
    if (isDistrictMode) {
        // District Mode
        const cb = Array.from(document.querySelectorAll('.dist-check')).find(el => el.dataset.name.toLowerCase() === name.toLowerCase());
        if (cb) {
            cb.checked = add;
            cb.dispatchEvent(new Event('change'));
            window.updateDistCount(cb);
        }
    } else {
        // Constituency Mode
        const cb = Array.from(document.querySelectorAll('.const-check')).find(el => el.dataset.name.toLowerCase() === name.toLowerCase());
        if (cb) {
            cb.checked = add;
            cb.dispatchEvent(new Event('change'));
            window.updateCount(cb);
        }
    }
    map.closePopup();
};

window.recalculateCampaignStats = function(distanceKm, durationHours) {
    const mileage = parseFloat(document.getElementById('formMileage').value) || 15;
    const fuelPrice = parseFloat(document.getElementById('formFuelPrice').value) || 102;
    
    const fuelNeeded = distanceKm / mileage;
    const totalCost = fuelNeeded * fuelPrice;
    const days = Math.max(1, Math.round((distanceKm / 300) + 0.4));
    
    const statsDistVal = document.getElementById('statsDistVal');
    const statsFuelVal = document.getElementById('statsFuelVal');
    const statsCostVal = document.getElementById('statsCostVal');
    const statsDaysVal = document.getElementById('statsDaysVal');
    
    const statTotalKm = document.getElementById('statTotalKm');
    const statFuel = document.getElementById('statFuel');
    const statCost = document.getElementById('statCost');
    const statDays = document.getElementById('statDays');
    
    const currency = window.sessionCurrency || "₹";
    
    if (statsDistVal) statsDistVal.textContent = distanceKm.toFixed(1) + " km";
    if (statsFuelVal) statsFuelVal.textContent = fuelNeeded.toFixed(2) + " L";
    if (statsCostVal) statsCostVal.textContent = currency + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (statsDaysVal) statsDaysVal.textContent = days;
    
    if (statTotalKm) statTotalKm.textContent = distanceKm.toFixed(1) + " km";
    if (statFuel) statFuel.textContent = fuelNeeded.toFixed(2) + " L";
    if (statCost) statCost.textContent = currency + totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (statDays) statDays.textContent = days;
    
    const statsStopsVal = document.getElementById('statsStopsVal');
    if (statsStopsVal) statsStopsVal.textContent = window.routeStops.length;
    
    window.updateTourScheduleTimeline(days);
};

window.updateTourScheduleTimeline = function(days) {
    const container = document.getElementById('tourScheduleWrapper');
    if (!container) return;
    
    if (window.routeStops.length === 0) {
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
    
    let html = '<div class="space-y-2">';
    const stopsPerDay = Math.ceil(window.routeStops.length / days) || 1;
    
    for (let dayIdx = 0; dayIdx < days; dayIdx++) {
        const dayNumber = dayIdx + 1;
        const dayStops = [];
        for (let idx = 0; idx < window.routeStops.length; idx++) {
            if (Math.floor(idx / stopsPerDay) === dayIdx) {
                dayStops.push({ name: window.routeStops[idx], overallIdx: idx });
            }
        }
        
        if (dayStops.length > 0) {
            const isOpen = dayIdx === 0 ? 'open' : '';
            html += `
                <div class="border border-gray-100 dark:border-white/5 rounded-xl overflow-hidden bg-gray-50 dark:bg-white/5 mb-2">
                    <details class="group" ${isOpen}>
                        <summary class="flex items-center justify-between py-2 px-3 font-semibold text-xs cursor-pointer select-none bg-primary/5 text-primary">
                            <span>Day ${dayNumber} Plan (${dayStops.length} stops)</span>
                            <i class="fa-solid fa-chevron-down text-[9px] text-gray-400 transition-transform group-open:rotate-180"></i>
                        </summary>
                        <div class="p-3 border-t border-gray-100 dark:border-white/5 space-y-2">
            `;
            
            dayStops.forEach((stopObj, sIdx) => {
                const isFirstOverall = stopObj.overallIdx === 0;
                const isLastOverall = stopObj.overallIdx === window.routeStops.length - 1;
                
                html += `
                    <div class="flex items-center gap-2">
                        <div class="w-4 h-4 rounded-full ${isFirstOverall ? 'bg-primary' : (isLastOverall ? 'bg-red-500' : 'bg-secondary')} flex items-center justify-center text-white text-[7px] font-bold flex-shrink-0">
                            ${isFirstOverall ? '<i class="fa-solid fa-flag text-[6px]"></i>' : (isLastOverall ? '<i class="fa-solid fa-map-pin text-[6px]"></i>' : (stopObj.overallIdx + 1))}
                        </div>
                        <div class="flex-1 py-1 px-2 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-lg flex justify-between items-center min-w-0">
                            <span class="font-semibold text-[9px] text-gray-700 dark:text-gray-300 truncate" title="${stopObj.name}">${stopObj.name}</span>
                            ${isFirstOverall ? '<span class="text-[6px] font-bold uppercase text-primary">Start</span>' : ''}
                            ${isLastOverall ? '<span class="text-[6px] font-bold uppercase text-red-500">End</span>' : ''}
                        </div>
                    </div>
                `;
                
                if (sIdx < dayStops.length - 1) {
                    html += `<div class="ml-2 w-px h-1 bg-gray-200 dark:bg-white/10"></div>`;
                }
            });
            
            html += `
                        </div>
                    </details>
                </div>
            `;
        }
    }
    
    html += '</div>';
    container.innerHTML = html;
};

window.switchFuelType = function(type) {
    window.currentFuelType = type;
    
    // Update tab active state using the .fw-tab CSS system
    ['Petrol', 'Diesel', 'Electric', 'CNG'].forEach(t => {
        const btn = document.getElementById('fuelTab' + t);
        if (btn) {
            if (t === type) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    // Show/hide param panels
    ['Petrol', 'Diesel', 'Electric', 'CNG'].forEach(t => {
        const el = document.getElementById('params' + t);
        if (el) {
            if (t === type) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });
    
    window.syncVehicleInputs();
};

window.selectVehicle = function(vehicleId) {
    if (!vehicleId) return;
    
    const v = window.vehiclesData.find(item => String(item.id) === String(vehicleId));
    if (v) {
        let ft = v.fuel_type;
        if (ft === 'Hybrid' || !['Petrol', 'Diesel', 'Electric', 'CNG'].includes(ft)) {
            ft = 'Petrol';
        }
        
        window.switchFuelType(ft);
        
        if (ft === 'Petrol') {
            document.getElementById('petrolMileage').value = v.mileage;
        } else if (ft === 'Diesel') {
            document.getElementById('dieselMileage').value = v.mileage;
        } else if (ft === 'Electric') {
            document.getElementById('evRange').value = v.mileage;
            document.getElementById('evBattery').value = v.tank_size || 60;
        } else if (ft === 'CNG') {
            document.getElementById('cngMileage').value = v.mileage;
        }
        
        window.syncVehicleInputs();
    }
};

window.syncVehicleInputs = function() {
    const formMil = document.getElementById('formMileage');
    const formPrice = document.getElementById('formFuelPrice');
    
    if (window.currentFuelType === 'Petrol') {
        formMil.value = document.getElementById('petrolMileage').value;
        formPrice.value = document.getElementById('petrolPrice').value;
    } else if (window.currentFuelType === 'Diesel') {
        formMil.value = document.getElementById('dieselMileage').value;
        formPrice.value = document.getElementById('dieselPrice').value;
    } else if (window.currentFuelType === 'Electric') {
        const range = parseFloat(document.getElementById('evRange').value) || 350;
        const battery = parseFloat(document.getElementById('evBattery').value) || 60;
        const costPerKwh = parseFloat(document.getElementById('evPrice').value) || 8;
        
        formMil.value = (range / battery).toFixed(3);
        formPrice.value = costPerKwh;
    } else if (window.currentFuelType === 'CNG') {
        formMil.value = document.getElementById('cngMileage').value;
        formPrice.value = document.getElementById('cngPrice').value;
    }
    
    window.triggerLivePreviewRecalc();
};

window.toggleAccordion = function(id) {
    const content = document.getElementById('content-' + id);
    const icon = document.getElementById('icon-' + id);
    if (!content || !icon) return;
    
    const isHidden = content.classList.contains('hidden');
    if (isHidden) {
        content.classList.remove('hidden');
        icon.style.transform = 'rotate(90deg)';
        activateDistrictGIS(id);
    } else {
        content.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
};

window.isDistrictSelected = function(distId) {
    const cb = document.querySelector(`.dist-check[value="${distId}"]`);
    return cb ? cb.checked : false;
};

window.toggleDistrictSelection = function(distId) {
    console.log(`[Campaign Map] Marker click -> Toggling selection for District: ${distId}`);
    const cb = document.querySelector(`.dist-check[value="${distId}"]`);
    if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
        window.updateDistrictMarkerStyle(distId);
    }
};

window.updateDistrictMarkerStyle = function(distId) {
    const marker = districtMarkers[distId];
    if (!marker) return;
    
    if (window.isDistrictSelected(distId)) {
        marker.setStyle({
            radius: 8,
            fillColor: '#F1C40F', // Golden amber highlight
            color: '#FFD700',
            weight: 3,
            fillOpacity: 1.0
        });
    } else {
        marker.setStyle({
            radius: 5,
            fillColor: '#000000',
            color: '#18A06A',
            weight: 1.5,
            fillOpacity: 0.9
        });
    }
};

window.isConstituencySelected = function(constId) {
    const cb = document.querySelector(`.const-check[value="${constId}"]`);
    return cb ? cb.checked : false;
};

window.toggleConstituencySelection = function(constId) {
    console.log(`[Campaign Map] Marker click -> Toggling selection for Constituency: ${constId}`);
    const cb = document.querySelector(`.const-check[value="${constId}"]`);
    if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
        
        if (cb.checked) {
            const distId = cb.dataset.districtId;
            const contentDiv = document.getElementById('content-' + distId);
            const icon = document.getElementById('icon-' + distId);
            if (contentDiv && contentDiv.classList.contains('hidden')) {
                contentDiv.classList.remove('hidden');
                if (icon) icon.style.transform = 'rotate(90deg)';
            }
        }
        window.updateConstituencyMarkerStyle(constId);
    }
};

window.updateConstituencyMarkerStyle = function(constId) {
    const marker = constituencyMarkers[constId];
    const poly = constituencyPolygons[constId];
    
    const isSel = window.isConstituencySelected(constId);
    if (marker) {
        if (isSel) {
            marker.setStyle({
                radius: 6,
                fillColor: '#F1C40F', // Golden amber highlight
                color: '#FFD700',
                weight: 2,
                fillOpacity: 1.0
            });
        } else {
            marker.setStyle({
                radius: 3.5,
                fillColor: '#2ECC71',
                color: '#FFFFFF',
                weight: 1,
                fillOpacity: 0.65
            });
        }
    }
    if (poly) {
        if (isSel) {
            poly.setStyle({
                color: '#FFD700',
                fillColor: '#F1C40F',
                weight: 2.5,
                fillOpacity: 0.35,
                opacity: 0.95
            });
        } else {
            poly.setStyle({
                color: '#18A06A',
                fillColor: '#0F7B53',
                weight: 1,
                fillOpacity: 0.05,
                opacity: 0.25
            });
        }
    }
};

window.syncMarkerStylesWithCheckboxes = function() {
    console.log("[Campaign Map] Syncing marker styles with selection checkboxes");
    window.allDistricts.forEach(d => {
        window.updateDistrictMarkerStyle(d.id);
    });
    window.allConstituencies.forEach(c => {
        window.updateConstituencyMarkerStyle(c.id);
    });
};

window.selectDistrictConsts = function(id, checked) {
    const content = document.getElementById('content-' + id);
    if (!content) return;
    
    content.querySelectorAll('.const-check').forEach(cb => {
        if (cb.closest('.const-item-checkbox').style.display !== 'none') {
            cb.checked = checked;
        }
    });
    window.updateCount();
};

window.updateCount = function(changedCb) {
    const selectedCheckboxes = document.querySelectorAll('.const-check:checked');
    const totalSelected = selectedCheckboxes.length;
    
    const uniqueDistricts = new Set();
    selectedCheckboxes.forEach(cb => {
        uniqueDistricts.add(cb.dataset.districtId);
    });
    
    const countLabel = document.getElementById('selectedCountLabel');
    if (countLabel) {
        countLabel.innerHTML = `Selected: <span class="text-primary font-black">${totalSelected} Constituencies</span>, <span class="text-secondary font-black">${uniqueDistricts.size} Districts</span>`;
    }
    
    const submitBtns = document.querySelectorAll('#campaignForm button[type="submit"]');
    submitBtns.forEach(btn => {
        btn.disabled = totalSelected === 0;
    });
    
    // Sync marker styles with new checked states
    window.syncMarkerStylesWithCheckboxes();
    
    window.updateLivePreview(totalSelected, uniqueDistricts.size, changedCb);
};

window.updateDistCount = function(changedCb) {
    const selectedCheckboxes = document.querySelectorAll('.dist-check:checked');
    const totalSelected = selectedCheckboxes.length;
    
    const countLabel = document.getElementById('selectedCountLabel');
    if (countLabel) {
        countLabel.innerHTML = `Selected: <span class="text-primary font-black">${totalSelected} Districts</span>`;
    }
    
    const submitBtns = document.querySelectorAll('#campaignForm button[type="submit"]');
    submitBtns.forEach(btn => {
        btn.disabled = totalSelected === 0;
    });
    
    // Sync marker styles with new checked states
    window.syncMarkerStylesWithCheckboxes();
    
    window.updateLivePreview(totalSelected, totalSelected, changedCb);
};

window.updateLivePreview = function(count, districtCount, changedCb) {
    const statsStopsVal = document.getElementById('statsStopsVal');
    const statsDistVal = document.getElementById('statsDistVal');
    const statsFuelVal = document.getElementById('statsFuelVal');
    const statsCostVal = document.getElementById('statsCostVal');
    const statsDaysVal = document.getElementById('statsDaysVal');
    
    const statTotalKm = document.getElementById('statTotalKm');
    const statFuel = document.getElementById('statFuel');
    const statCost = document.getElementById('statCost');
    const statDays = document.getElementById('statDays');
    const statDistricts = document.getElementById('statDistricts');
    const statConstituencies = document.getElementById('statConstituencies');
    const statCoverage = document.getElementById('statCoverage');
    
    const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
    
    if (window.routeStops.length > 0) {
        // Display exact stats from server-generated route path
        const readyBadge = document.getElementById('readyBadge');
        if (readyBadge) readyBadge.classList.remove('hidden');
        
        if (statsStopsVal) statsStopsVal.textContent = window.routeStops.length;
        if (statsDistVal) statsDistVal.textContent = window.serverTotalKm + " km";
        if (statsFuelVal) statsFuelVal.textContent = window.serverFuelNeeded + " L";
        if (statsCostVal) statsCostVal.textContent = window.serverCurrency + Number(window.serverTotalCost).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        if (statsDaysVal) statsDaysVal.textContent = window.serverDays;
        
        if (statTotalKm) statTotalKm.textContent = window.serverTotalKm + " km";
        if (statFuel) statFuel.textContent = window.serverFuelNeeded + " L";
        if (statCost) statCost.textContent = window.serverCurrency + Number(window.serverTotalCost).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        if (statDays) statDays.textContent = window.serverDays;
        
        if (statDistricts) {
            statDistricts.textContent = isDistrictMode ? window.routeStops.length : window.serverDistrictCount;
        }
        if (statConstituencies) {
            statConstituencies.textContent = isDistrictMode ? '-' : window.routeStops.length;
        }
        if (statCoverage) {
            const denom = isDistrictMode ? 38 : 234;
            statCoverage.textContent = `${((window.routeStops.length / denom) * 100).toFixed(1)}%`;
        }
        if (map) renderServerRoute();
    } else {
        // Display draft selections stats
        const readyBadge = document.getElementById('readyBadge');
        if (readyBadge) readyBadge.classList.add('hidden');
        
        if (statsStopsVal) statsStopsVal.textContent = "0";
        if (statsDistVal) statsDistVal.textContent = "0 km";
        if (statsFuelVal) statsFuelVal.textContent = "0 L";
        if (statsCostVal) statsCostVal.textContent = "₹0";
        if (statsDaysVal) statsDaysVal.textContent = "0";
        
        if (statTotalKm) statTotalKm.textContent = "0 km";
        if (statFuel) statFuel.textContent = "0 L";
        if (statCost) statCost.textContent = "₹0";
        if (statDays) statDays.textContent = "0";
        
        if (isDistrictMode) {
            if (statDistricts) statDistricts.textContent = count;
            if (statConstituencies) statConstituencies.textContent = '-';
            if (statCoverage) statCoverage.textContent = `${((count / 38) * 100).toFixed(1)}%`;
        } else {
            if (statDistricts) statDistricts.textContent = districtCount;
            if (statConstituencies) statConstituencies.textContent = count;
            if (statCoverage) statCoverage.textContent = `${((count / 234) * 100).toFixed(1)}%`;
        }
        
        if (map) updateMapSelections(changedCb);
    }
};

window.triggerLivePreviewRecalc = function() {
    const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
    if (isDistrictMode) {
        window.updateDistCount();
    } else {
        window.updateCount();
    }
};

window.quickSelectConst = function(n) {
    const checks = document.querySelectorAll('.const-check');
    checks.forEach((c, i) => {
        c.checked = i < n;
        const distId = c.dataset.districtId;
        const contentDiv = document.getElementById('content-' + distId);
        const icon = document.getElementById('icon-' + distId);
        if (contentDiv && i < n && contentDiv.classList.contains('hidden')) {
            contentDiv.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(90deg)';
        }
    });
    window.updateCount();
};

window.quickSelectDist = function(n) {
    const checks = document.querySelectorAll('.dist-check');
    checks.forEach((c, i) => {
        c.checked = i < n;
    });
    window.updateDistCount();
};

window.clearAll = function() {
    document.querySelectorAll('.const-check').forEach(c => c.checked = false);
    window.updateCount();
    
    document.querySelectorAll('.district-accordion-item').forEach(item => {
        const distId = item.id.replace('district-item-', '');
        const content = document.getElementById('content-' + distId);
        const icon = document.getElementById('icon-' + distId);
        if (content) content.classList.add('hidden');
        if (icon) icon.style.transform = 'rotate(0deg)';
    });
    
    if (window.routeStops.length === 0) {
        window.resetMapZoom();
    }
};

window.clearDistAll = function() {
    document.querySelectorAll('.dist-check').forEach(c => c.checked = false);
    window.updateDistCount();
    
    if (window.routeStops.length === 0) {
        window.resetMapZoom();
    }
};

window.applyAccordionFilters = function() {
    const q = (document.getElementById('constSearch')?.value || '').toLowerCase();
    const distFilter = (document.getElementById('districtFilter')?.value || '').toLowerCase();
    
    document.querySelectorAll('.district-accordion-item').forEach(districtItem => {
        const districtHeader = districtItem.querySelector('.district-accordion-header span');
        const districtName = (districtHeader?.textContent || '').toLowerCase();
        const districtId = districtItem.id.replace('district-item-', '');
        const contentDiv = document.getElementById('content-' + districtId);
        const icon = document.getElementById('icon-' + districtId);
        
        let hasVisibleConst = false;
        const matchesDistrictDropdown = !distFilter || districtName.includes(distFilter.toLowerCase());
        
        districtItem.querySelectorAll('.const-item-checkbox').forEach(label => {
            const name = (label.dataset.name || '').toLowerCase();
            const matchesSearch = !q || name.includes(q);
            
            if (matchesSearch && matchesDistrictDropdown) {
                label.style.display = 'flex';
                hasVisibleConst = true;
            } else {
                label.style.display = 'none';
            }
        });
        
        if (hasVisibleConst && matchesDistrictDropdown) {
            districtItem.style.display = 'block';
            if ((q || distFilter) && contentDiv && contentDiv.classList.contains('hidden')) {
                contentDiv.classList.remove('hidden');
                if (icon) icon.style.transform = 'rotate(90deg)';
            }
        } else {
            districtItem.style.display = 'none';
        }
    });
};

window.applyDistrictFilters = function() {
    const q = (document.getElementById('constSearch')?.value || '').toLowerCase();
    document.querySelectorAll('#districtGrid .const-item-checkbox').forEach(label => {
        const name = (label.dataset.name || '').toLowerCase();
        if (!q || name.includes(q)) {
            label.style.display = 'flex';
        } else {
            label.style.display = 'none';
        }
    });
};

window.zoomToDistrictGIS = function(distId) {
    if (!distId) return;
    activateDistrictGIS(distId);
};

window.clearCampaignRoute = function() {
    const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
    if (isDistrictMode) {
        window.clearDistAll();
    } else {
        window.clearAll();
    }
    
    // Clear route rendering
    if (serverRouteGroup) {
        map.removeLayer(serverRouteGroup);
        serverRouteGroup = null;
    }
    
    // Clear backend route stops
    window.routeStops = [];
    window.recalculateCampaignStats(0, 0);
};

window.resetMapZoom = function() {
    if (!map) return;
    map.flyTo([11.1271, 78.6569], 7, { animate: true, duration: 0.8 });
    map.closePopup();
    deactivateActiveDistrictGIS();
    updateViewportRendering();
};

window.submitCampaignForm = function() {
    const form = document.getElementById('campaignForm');
    if (form) form.submit();
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

function updateMapSelections(changedCb) {
    if (!map) return;
    
    if (liveRouteGroup) {
        map.removeLayer(liveRouteGroup);
    }
    liveRouteGroup = L.layerGroup().addTo(map);
    
    const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
    const checkedSelectors = isDistrictMode ? '.dist-check:checked' : '.const-check:checked';
    const checks = document.querySelectorAll(checkedSelectors);
    
    const coords = [];
    checks.forEach(cb => {
        const name = cb.dataset.name;
        const ptCoords = getCampaignCoordinate(name);
        if (ptCoords) {
            coords.push(ptCoords);
            const marker = L.circleMarker(ptCoords, {
                radius: 6, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1.5, fillOpacity: 0.95
            }).addTo(liveRouteGroup);
            marker.bindPopup(getCampaignPopupHtml(name, isDistrictMode ? "District Capital" : "Assembly Constituency"));
        }
    });
    
    // Zoom/Fit selected bounds silently on change
    if (coords.length > 0 && changedCb) {
        try {
            const bounds = L.latLngBounds(coords);
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
        } catch(e) {
            console.error("Zoom fitting failed", e);
        }
    }
}

/**
 * Draws the backend calculated OSRM campaign route.
 */
async function renderServerRoute() {
    if (serverRouteGroup) {
        map.removeLayer(serverRouteGroup);
        serverRouteGroup = null;
    }
    
    const stopCoords = [];
    window.routeStops.forEach(stopName => {
        const coords = getCampaignCoordinate(stopName);
        if (coords) {
            stopCoords.push([coords[0], coords[1], stopName]);
        }
    });
    
    if (stopCoords.length < 2) return;
    
    // Fetch resilient road routing via routingProvider
    const coordsOnly = stopCoords.map(c => [c[0], c[1]]);
    
    try {
        const routeData = await window.routingProvider.resolveRoute(window.routeStops, coordsOnly, false);
        
        const outerGlow = L.geoJSON(routeData.geometry, {
            style: { color: '#0F7B53', weight: 8, opacity: 0.35 }
        });
        const coreLine = L.geoJSON(routeData.geometry, {
            style: { color: '#2ECC71', weight: 4, opacity: 0.95 }
        });
        
        const routeNodes = [];
        stopCoords.forEach((coord, idx) => {
            const isStart = idx === 0;
            const isEnd = idx === stopCoords.length - 1;
            
            const pinIcon = createCustomPin(isStart ? '#2ECC71' : (isEnd ? '#EF4444' : '#18A06A'), isStart ? 'A' : (isEnd ? 'B' : String(idx + 1)));
            const marker = L.marker([coord[0], coord[1]], { icon: pinIcon });
            
            let label = `<div class="text-xs font-bold text-gray-100">${coord[2]}</div>`;
            if (isStart) label += `<div class="text-[9px] uppercase text-primary font-black mt-0.5">Start Point</div>`;
            else if (isEnd) label += `<div class="text-[9px] uppercase text-red-500 font-black mt-0.5">Destination</div>`;
            else label += `<div class="text-[9px] text-gray-400">Stop #${idx + 1}</div>`;
            
            marker.bindPopup(label);
            routeNodes.push(marker);
        });
        
        serverRouteGroup = L.layerGroup([outerGlow, coreLine, ...routeNodes]).addTo(map);
        
        // Fit view bounds
        const bounds = outerGlow.getBounds();
        map.fitBounds(bounds, { padding: [50, 50] });
        
        // Recalculate cost metrics live using OSRM metrics
        window.recalculateCampaignStats(routeData.distance, routeData.duration);
        
    } catch (e) {
        console.error("OSRM drawing failed in Campaign, drawing straight line segments.", e);
        
        const baseGlow = L.polyline(coordsOnly, { color: '#2ECC71', weight: 9, opacity: 0.35 });
        const coreLine = L.polyline(coordsOnly, { color: '#0F7B53', weight: 3, opacity: 0.95 });
        
        const routeNodes = [];
        stopCoords.forEach((coord, idx) => {
            const isStart = idx === 0;
            const isEnd = idx === stopCoords.length - 1;
            
            const nodeMarker = L.circleMarker([coord[0], coord[1]], {
                radius: isStart || isEnd ? 8 : 6,
                fillColor: isStart ? '#0F7B53' : (isEnd ? '#EF4444' : '#18A06A'),
                color: '#FFFFFF', weight: 2, fillOpacity: 0.95
            });
            nodeMarker.bindPopup(`<b>${coord[2]}</b><br>${isStart ? 'Start' : (isEnd ? 'End' : 'Stop')}`);
            routeNodes.push(nodeMarker);
        });
        
        serverRouteGroup = L.layerGroup([baseGlow, coreLine, ...routeNodes]).addTo(map);
        const bounds = L.latLngBounds(coordsOnly);
        map.fitBounds(bounds, { padding: [50, 50] });
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
            const closestDist = window.findClosestDistrict(item.lat, item.lng);
            if (closestDist) activateDistrictGIS(closestDist.id);
        }
        
        L.popup()
            .setLatLng([item.lat, item.lng])
            .setContent(getCampaignPopupHtml(item.name, item.type))
            .openOn(map);
    }
};

/**
 * Initializes the campaign mapping layout.
 */
window.initCampaignMap = async function() {
    const skeleton = document.getElementById('mapSkeleton');
    if (skeleton) {
        skeleton.style.display = 'flex';
        skeleton.style.opacity = '1';
    }

    try {
        // Step 1: Load Leaflet JS & CSS resources immediately
        await window.lazyLoadMapResources();
    } catch(e) {
        console.error("Leaflet resources load failed in Campaign", e);
        if (skeleton) {
            skeleton.style.display = 'none';
        }
        return;
    }
    
    // Step 2: Set up Leaflet Map object instantly with smooth animations and inertia
    map = L.map('plannerMap', {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
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
            
            marker.bindPopup(getCampaignPopupHtml(d.name, `District capital`));
            marker.bindTooltip(`<b>${d.name}</b>`, { direction: 'top', offset: [0, -4] });
            
            districtMarkers[d.id] = marker;
            districtBoundsCircles[d.id] = circle;
            
            // Hover effect for discoverability
            marker.on('mouseover', function() {
                if (!window.isDistrictSelected(d.id)) {
                    marker.setStyle({ radius: 7.5, color: '#2ECC71', weight: 2.5, fillOpacity: 0.95 });
                }
            });
            marker.on('mouseout', function() {
                if (!window.isDistrictSelected(d.id)) {
                    marker.setStyle({ radius: 5, fillColor: '#000000', color: '#18A06A', weight: 1.5, fillOpacity: 0.9 });
                }
            });
            
            // Click handler: Activate GIS & Toggle selection if in District mode
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                activateDistrictGIS(d.id);
                const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
                if (isDistrictMode) {
                    window.toggleDistrictSelection(d.id);
                }
            });
        });
        map.addLayer(mapLayers.districts);
        
        // Add other major cities/towns
        const renderedHqs = new Set(window.allDistricts.map(d => d.hq.toLowerCase()));
        for (let cityName in window.majorCitiesCoords) {
            if (!renderedHqs.has(cityName.toLowerCase())) {
                const coords = window.majorCitiesCoords[cityName];
                const marker = L.circleMarker(coords, { radius: 4, fillColor: '#000000', color: '#3498DB', weight: 1.5, fillOpacity: 0.8 });
                marker.bindPopup(getCampaignPopupHtml(cityName, `Major City / Town`));
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
            
            const popupText = getCampaignPopupHtml(c.name, `${c.district} Assembly constituency`);
            poly.bindPopup(popupText);
            marker.bindPopup(popupText);
            poly.bindTooltip(`${c.name} constituency`, { sticky: true });
            
            // Store references
            constituencyMarkers[c.id] = marker;
            constituencyPolygons[c.id] = poly;

            // Hover effects & click toggles for constituency marker
            marker.on('mouseover', function() {
                if (!window.isConstituencySelected(c.id)) {
                    marker.setStyle({ radius: 5.5, fillColor: '#18A06A', weight: 2 });
                }
            });
            marker.on('mouseout', function() {
                if (!window.isConstituencySelected(c.id)) {
                    marker.setStyle({ radius: 3.5, fillColor: '#2ECC71', color: '#FFFFFF', weight: 1, fillOpacity: 0.65 });
                }
            });
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
                if (!isDistrictMode) {
                    window.toggleConstituencySelection(c.id);
                }
            });

            // Hover effects & click toggles for constituency polygon
            poly.on('mouseover', function() {
                if (!window.isConstituencySelected(c.id)) {
                    poly.setStyle({ color: '#2ECC71', weight: 2, fillOpacity: 0.15 });
                }
            });
            poly.on('mouseout', function() {
                if (!window.isConstituencySelected(c.id)) {
                    poly.setStyle({ color: '#18A06A', weight: 1, fillColor: '#0F7B53', fillOpacity: 0.05, opacity: 0.25 });
                }
            });
            poly.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                const isDistrictMode = (window.routeType === "district" || document.getElementById('tabInput')?.value === 'district');
                if (!isDistrictMode) {
                    window.toggleConstituencySelection(c.id);
                }
            });
            
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
            marker.bindPopup(getCampaignPopupHtml(p.name, `${p.type.replace('_', ' ')} POI`));
            marker.bindTooltip(p.name, { direction: 'top', offset: [0, -3] });
            
            if (p.district_id && districtGISGroups[p.district_id]) districtGISGroups[p.district_id].addLayer(marker);
        });
        
        // Initial bindings
        window.switchFuelType('Petrol');
        
        if (window.routeStops && window.routeStops.length > 0) {
            await renderServerRoute();
        } else {
            updateMapSelections(false);
        }
        
        window.syncMarkerStylesWithCheckboxes();
        updateViewportRendering();
    }).catch(e => {
        console.error("Background static GIS load failed in Campaign", e);
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
