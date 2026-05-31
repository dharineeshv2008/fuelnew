/**
 * FuelWise Route Cache Layer
 * Persists route information (distance, duration, geometry) in localStorage.
 */
class FuelWiseRouteCache {
    constructor(prefix = "fw-route-") {
        this.prefix = prefix;
        this.memoryCache = new Map();
    }

    /**
     * Generates a unique key from a coordinate list.
     * @param {Array<[number, number]>} coords - [[lat, lng], [lat, lng]...]
     * @returns {string}
     */
    _makeKey(coords) {
        return coords.map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(';');
    }

    /**
     * Retrieves a cached route.
     * @param {Array<[number, number]>} coords 
     * @returns {Object|null} Cached route data or null
     */
    get(coords) {
        const key = this._makeKey(coords);
        
        // Check memory cache first
        if (this.memoryCache.has(key)) {
            return this.memoryCache.get(key);
        }

        // Check localStorage
        try {
            const cached = localStorage.getItem(this.prefix + key);
            if (cached) {
                const parsed = JSON.parse(cached);
                this.memoryCache.set(key, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn("Failed to read from localStorage cache", e);
        }

        return null;
    }

    /**
     * Stores a route in cache.
     * @param {Array<[number, number]>} coords 
     * @param {Object} data - { distance, duration, geometry, source }
     */
    set(coords, data) {
        const key = this._makeKey(coords);
        this.memoryCache.set(key, data);

        try {
            localStorage.setItem(this.prefix + key, JSON.stringify(data));
        } catch (e) {
            console.warn("Failed to write to localStorage cache", e);
            // If quota exceeded, clear old items
            this.clearOldCache();
        }
    }

    /**
     * Clears all localStorage keys matching the prefix.
     */
    clear() {
        this.memoryCache.clear();
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.prefix)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) {
            console.error("Failed to clear localStorage cache", e);
        }
    }

    /**
     * Clears old cache keys if quota is full.
     */
    clearOldCache() {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.prefix)) {
                    keys.push(key);
                }
            }
            // Remove first 20 keys (simplistic FIFO eviction)
            keys.slice(0, Math.min(20, keys.length)).forEach(k => localStorage.removeItem(k));
        } catch (e) {
            console.error("Evicting cache keys failed", e);
        }
    }
}

// Export singleton instance globally
window.routeCache = new FuelWiseRouteCache();
