import os
from app import app

if __name__ == "__main__":
    # Get port from environment variable or default to 5000
    port = int(os.environ.get("PORT", 5000))
    
    # Get debug mode from environment
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    
    print(f"Fuel Cost Calculator is starting...")
    print(f"Local Address: http://127.0.0.1:{port}")
    
    app.run(host="127.0.0.1", port=port, debug=debug)
