"""
Smart Plant Watering System - Serial to WebSocket / HTTP Bridge (Optional)
Useful for remote network monitoring or headless setups (e.g. Raspberry Pi).
Connects to Arduino Uno via COM port and relays telemetry over a local WebSocket server.
"""

import sys
import time
import json
import asyncio
try:
    import serial
    import websockets
except ImportError:
    print("Please install required dependencies: pip install pyserial websockets")
    sys.exit(1)

# Default Serial Port - Modify to match your Arduino COM port (e.g., 'COM3' on Windows or '/dev/ttyUSB0' on Linux)
SERIAL_PORT = 'COM3'
BAUD_RATE = 9600
WS_PORT = 8765

connected_clients = set()
arduino = None

async def serial_reader():
    global arduino
    while True:
        try:
            if arduino and arduino.is_open:
                if arduino.in_waiting > 0:
                    line = arduino.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        print(f"[SERIAL RX]: {line}")
                        # Broadcast to all connected web clients
                        if connected_clients:
                            await asyncio.gather(
                                *[client.send(line) for client in connected_clients],
                                return_exceptions=True
                            )
            await asyncio.sleep(0.05)
        except Exception as e:
            print(f"[ERROR in serial_reader]: {e}")
            await asyncio.sleep(1)

async def ws_handler(websocket):
    global arduino
    connected_clients.add(websocket)
    print(f"[WS] Client connected. Total clients: {len(connected_clients)}")
    try:
        async for message in websocket:
            print(f"[WS RX]: {message}")
            if arduino and arduino.is_open:
                arduino.write((message + '\n').encode('utf-8'))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print(f"[WS] Client disconnected. Total clients: {len(connected_clients)}")

def main():
    global arduino
    port = sys.argv[1] if len(sys.argv) > 1 else SERIAL_PORT
    print(f"Connecting to Arduino on {port} at {BAUD_RATE} baud...")
    
    try:
        arduino = serial.Serial(port, BAUD_RATE, timeout=1)
        time.sleep(2) # Wait for Arduino reset
        print("Connected to Arduino successfully.")
    except Exception as e:
        print(f"Failed to open serial port {port}: {e}")
        print("Note: The frontend supports direct Web Serial in Google Chrome / Edge without needing this script!")

    async def start_server():
        async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
            print(f"WebSocket bridge server running on ws://localhost:{WS_PORT}")
            await serial_reader()

    asyncio.run(start_server())

if __name__ == '__main__':
    main()
