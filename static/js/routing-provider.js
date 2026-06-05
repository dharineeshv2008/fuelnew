/**
 * FuelWise Resilient Routing Provider
 * Manages the routing hierarchy: OSRM -> distances.json matrix -> straight-line math.
 */
class FuelWiseRoutingProvider {
    constructor() {
        this.distancesMatrix = {}; // Loaded dynamically
    }

    /**
     * Set the local lookup matrix loaded from distances.json.
     * @param {Object} matrix 
     */
    setMatrix(matrix) {
        this.distancesMatrix = matrix || {};
    }

    /**
     * Compute Haversine distance between two points in km.
     */
    haversineDistance(coords1, coords2) {
        const R = 6371; // Earth radius in km
        const dLat = (coords2[0] - coords1[0]) * Math.PI / 180;
        const dLon = (coords2[1] - coords1[1]) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(coords1[0] * Math.PI / 180) * Math.cos(coords2[0] * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Resolves the distance between two named cities from the local matrix.
     */
    findMatrixDistance(origin, dest) {
        if (!origin || !dest || origin === dest) return 0;
        let d = this.distancesMatrix[origin]?.[dest];
        if (d === undefined) {
            d = this.distancesMatrix[dest]?.[origin];
        }
        return d;
    }

    /**
     * Main route resolution method.
     * Checks cache, runs OSRM, falls back to matrix, or Haversine approximation.
     * @param {Array<string>} namesList 
     * @param {Array<[number, number]>} coordsList 
     * @param {boolean} optimize 
     * @returns {Promise<Object>} The resolved route details { distance, duration, geometry, source }
     */
    async resolveRoute(namesList, coordsList, optimize = false) {
        if (coordsList.length < 2) {
            throw new Error("At least two coordinates are required for routing.");
        }

        // ── Debug Logging ──────────────────────────────────────────────────────
        const originName      = namesList[0];
        const destName        = namesList[namesList.length - 1];
        const waypointNames   = namesList.slice(1, -1);
        console.log("╔══════════════════════════════════════════════");
        console.log("║ [RoutingProvider] Route Resolution");
        console.log("║ Origin     :", originName, coordsList[0]);
        console.log("║ Destination:", destName, coordsList[coordsList.length - 1]);
        console.log("║ Waypoints  :", waypointNames.length > 0 ? waypointNames : "(none)");
        console.log("╚══════════════════════════════════════════════");

        // 1. Check Cache
        if (window.routeCache) {
            const cached = window.routeCache.get(coordsList);
            if (cached) {
                console.log("[RoutingProvider] Cache Hit:", cached);
                return cached;
            }
        }

        // 2. Try OSRM (Primary Source)
        try {
            const osrmCoords = coordsList.map(c => `${c[1]},${c[0]}`).join(';');
            let url = "";
            if (optimize && coordsList.length > 3) {
                url = `https://router.project-osrm.org/trip/v1/driving/${osrmCoords}?overview=full&geometries=geojson&source=first&destination=last`;
            } else {
                // Build waypoints index list: 0;1;2;...;N to force route through ALL points
                const waypointIndices = coordsList.map((_, i) => i).join(';');
                url = `https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson&waypoints=${waypointIndices}`;
            }

            console.log("[RoutingProvider] OSRM URL:", url);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout for OSRM response

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error("OSRM server returned error");
            const data = await response.json();
            
            if (data.code === "Ok") {
                const route = optimize ? data.trips[0] : data.routes[0];

                // Validate route geometry
                if (!route.geometry || !route.geometry.coordinates || route.geometry.coordinates.length < 2) {
                    throw new Error("OSRM returned invalid geometry for waypoint route");
                }

                const resolvedRoute = {
                    distance: route.distance / 1000.0, // convert to km
                    duration: route.duration / 3600.0, // convert to hours
                    geometry: route.geometry, // GeoJSON structure
                    legs: (route.legs || []).map(l => l.distance / 1000.0),
                    source: "OSRM"
                };

                console.log("[RoutingProvider] OSRM resolved →", {
                    distance: resolvedRoute.distance.toFixed(1) + " km",
                    duration: resolvedRoute.duration.toFixed(2) + " hrs",
                    legs: resolvedRoute.legs.map(l => l.toFixed(1) + " km"),
                    source: resolvedRoute.source
                });

                // Cache it
                if (window.routeCache) {
                    window.routeCache.set(coordsList, resolvedRoute);
                }

                return resolvedRoute;
            }
        } catch (e) {
            console.warn("[RoutingProvider] OSRM routing failed. Falling back to local matrix...", e);
            showToast("OSRM routing unavailable. Operating in local fallback mode.", "warning");
        }


        // 3. Try Local Matrix Fallback (distances.json)
        try {
            let totalDistance = 0;
            const legs = [];
            
            for (let i = 0; i < namesList.length - 1; i++) {
                let segmentDist = this.findMatrixDistance(namesList[i], namesList[i+1]);
                if (segmentDist === undefined) {
                    // Fallback to Haversine straight line for this segment
                    const c1 = coordsList[i];
                    const c2 = coordsList[i+1];
                    segmentDist = this.haversineDistance(c1, c2) * 1.25; // 1.25 winding factor adjustment
                }
                totalDistance += segmentDist;
                legs.push(segmentDist);
            }

            const mockGeometry = {
                type: "LineString",
                coordinates: coordsList.map(c => [c[1], c[0]]) // GeoJSON expects [lng, lat]
            };

            const durationHours = totalDistance / 60.0; // Assumed 60 km/h average speed

            const resolvedRoute = {
                distance: totalDistance,
                duration: durationHours,
                geometry: mockGeometry,
                legs: legs,
                source: "Matrix"
            };

            return resolvedRoute;
        } catch (e) {
            console.error("Local matrix fallback computation failed. Running emergency straight-line calculation.", e);
        }

        // 4. Try Emergency straight-line calculation (Tertiary Fallback)
        let totalDistance = 0;
        const legs = [];
        for (let i = 0; i < coordsList.length - 1; i++) {
            const segmentDist = this.haversineDistance(coordsList[i], coordsList[i+1]) * 1.3; // 1.3 factor
            totalDistance += segmentDist;
            legs.push(segmentDist);
        }

        const mockGeometry = {
            type: "LineString",
            coordinates: coordsList.map(c => [c[1], c[0]])
        };

        return {
            distance: totalDistance,
            duration: totalDistance / 55.0, // Assumed 55 km/h emergency speed
            geometry: mockGeometry,
            legs: legs,
            source: "Emergency Approximation"
        };
    }
}

// Helper to show toasts dynamically (works even if base toast elements aren't loaded)
function showToast(message, category = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `fw-toast ${category}`;
    
    let iconClass = "fa-circle-info";
    if (category === "success") iconClass = "fa-circle-check";
    else if (category === "error") iconClass = "fa-circle-xmark";
    else if (category === "warning") iconClass = "fa-triangle-exclamation";
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = "translateX(120%)";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Export singleton instance globally
window.routingProvider = new FuelWiseRoutingProvider();
