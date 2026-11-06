/*
 * =====================================================================
 * Smart Plant Watering System - IoT Portfolio Project
 * Microcontroller: Arduino Uno R3
 * Author: Portfolio Showcase
 * 
 * Hardware Connections:
 * - Soil Moisture Sensor Analog Out (AO) -> Arduino Pin A0
 * - Soil Moisture Sensor VCC -> Arduino 5V
 * - Soil Moisture Sensor GND -> Arduino GND
 * - Relay Module Signal (IN) -> Arduino Digital Pin 7
 * - Relay Module VCC -> Arduino 5V
 * - Relay Module GND -> Arduino GND
 * - Submersible Pump -> Powered via external 18650 Battery pack through Relay (NO / COM)
 * =====================================================================
 */

#include <Arduino.h>

// --- Pin Definitions ---
const int MOISTURE_PIN = A0;
const int RELAY_PIN    = 7;
const int LED_PIN      = 13; // Built-in status indicator

// --- Relay Logic Configuration ---
// Most single-channel relay modules are ACTIVE_LOW (LOW = ON, HIGH = OFF)
const bool RELAY_ACTIVE_LOW = true;

// --- Sensor Calibration Constants ---
// Run calibration test in dry air and water to fine-tune these values
int airValue   = 750; // Raw analog value when sensor is dry in air
int waterValue = 280; // Raw analog value when sensor is immersed in water

// --- System Configuration & Defaults ---
int moistureThreshold = 30; // Pump triggers automatically if moisture < 30%
bool autoModeEnabled  = true; // Starts in AUTO mode by default
const unsigned long TELEMETRY_INTERVAL_MS = 1000; // Send telemetry every 1 sec
const unsigned long AUTO_PUMP_BURST_MS    = 3000; // Water for 3 seconds per cycle
const unsigned long AUTO_COOLDOWN_MS      = 7000; // Wait 7s for water to soak into soil
const unsigned long MAX_SAFETY_PUMP_MS    = 10000; // Safety cutoff: Never run pump > 10s continuously

// --- State Variables ---
bool isPumpRunning = false;
unsigned long lastTelemetryTime = 0;
unsigned long pumpStartTime     = 0;
unsigned long lastWateringTime  = 0;
String serialInputBuffer = "";

// Helper function to turn pump ON
void setPump(bool state) {
  isPumpRunning = state;
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, state ? LOW : HIGH);
  } else {
    digitalWrite(RELAY_PIN, state ? HIGH : LOW);
  }
  digitalWrite(LED_PIN, state ? HIGH : LOW);

  if (state) {
    pumpStartTime = millis();
  }
}

// Read and calculate calibrated soil moisture percentage (0% - 100%)
int readMoisture(int &rawOut) {
  // Take 5 samples and average them for reading stability
  long total = 0;
  for (int i = 0; i < 5; i++) {
    total += analogRead(MOISTURE_PIN);
    delay(10);
  }
  rawOut = total / 5;

  // Map raw analog reading to percentage:
  // Raw high = dry (0%), Raw low = wet (100%)
  int percentage = map(rawOut, airValue, waterValue, 0, 100);
  percentage = constrain(percentage, 0, 100);
  return percentage;
}

// Send JSON telemetry over Serial to Web Dashboard
void sendTelemetry(int moisture, int raw) {
  Serial.print(F("{\"moisture\":"));
  Serial.print(moisture);
  Serial.print(F(",\"raw\":"));
  Serial.print(raw);
  Serial.print(F(",\"pump\":"));
  Serial.print(isPumpRunning ? 1 : 0);
  Serial.print(F(",\"mode\":\""));
  Serial.print(autoModeEnabled ? "AUTO" : "MANUAL");
  Serial.print(F("\",\"threshold\":"));
  Serial.print(moistureThreshold);
  Serial.print(F(",\"uptime\":"));
  Serial.print(millis() / 1000);
  Serial.println(F("}"));
}

// Process commands received from Web Dashboard
void processCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "PUMP_ON") {
    autoModeEnabled = false; // Switch to manual control
    setPump(true);
    Serial.println(F("{\"ack\":\"PUMP_ON\",\"status\":\"SUCCESS\"}"));
  }
  else if (cmd == "PUMP_OFF") {
    setPump(false);
    Serial.println(F("{\"ack\":\"PUMP_OFF\",\"status\":\"SUCCESS\"}"));
  }
  else if (cmd == "PUMP_BURST") {
    // Run a manual 3-second burst
    setPump(true);
    Serial.println(F("{\"ack\":\"PUMP_BURST\",\"status\":\"RUNNING\"}"));
  }
  else if (cmd == "MODE_AUTO") {
    autoModeEnabled = true;
    Serial.println(F("{\"ack\":\"MODE_AUTO\",\"status\":\"SUCCESS\"}"));
  }
  else if (cmd == "MODE_MANUAL") {
    autoModeEnabled = false;
    setPump(false);
    Serial.println(F("{\"ack\":\"MODE_MANUAL\",\"status\":\"SUCCESS\"}"));
  }
  else if (cmd.startsWith("SET_THRESHOLD:")) {
    int newThresh = cmd.substring(14).toInt();
    if (newThresh >= 5 && newThresh <= 95) {
      moistureThreshold = newThresh;
      Serial.print(F("{\"ack\":\"SET_THRESHOLD\",\"val\":"));
      Serial.print(moistureThreshold);
      Serial.println(F("}"));
    }
  }
  else if (cmd.startsWith("CALIBRATE_AIR:")) {
    airValue = cmd.substring(14).toInt();
    Serial.println(F("{\"ack\":\"CALIBRATE_AIR\",\"status\":\"SAVED\"}"));
  }
  else if (cmd.startsWith("CALIBRATE_WATER:")) {
    waterValue = cmd.substring(16).toInt();
    Serial.println(F("{\"ack\":\"CALIBRATE_WATER\",\"status\":\"SAVED\"}"));
  }
}

void setup() {
  Serial.begin(9600);
  
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(MOISTURE_PIN, INPUT);

  // Initialize pump in OFF state
  setPump(false);

  // Reserve memory for serial string buffer
  serialInputBuffer.reserve(64);

  // Startup broadcast
  Serial.println(F("{\"system\":\"SMART_PLANT_WATERING\",\"status\":\"READY\"}"));
}

void loop() {
  unsigned long currentMillis = millis();

  // 1. Read Serial input from Web Dashboard
  while (Serial.available() > 0) {
    char inChar = (char)Serial.read();
    if (inChar == '\n' || inChar == '\r') {
      if (serialInputBuffer.length() > 0) {
        processCommand(serialInputBuffer);
        serialInputBuffer = "";
      }
    } else {
      serialInputBuffer += inChar;
    }
  }

  // 2. Read Moisture Sensor
  int rawValue = 0;
  int moisturePercent = readMoisture(rawValue);

  // 3. Safety Cutoff Check: Prevent continuous pumping overflow
  if (isPumpRunning && (currentMillis - pumpStartTime >= MAX_SAFETY_PUMP_MS)) {
    setPump(false);
    lastWateringTime = currentMillis;
    Serial.println(F("{\"warning\":\"SAFETY_TIMEOUT_REACHED\",\"pump\":0}"));
  }

  // 4. Automatic Mode Logic
  if (autoModeEnabled) {
    if (isPumpRunning) {
      // Check if burst duration has elapsed
      if (currentMillis - pumpStartTime >= AUTO_PUMP_BURST_MS) {
        setPump(false);
        lastWateringTime = currentMillis;
      }
    } else {
      // Only water if moisture is below threshold AND cooldown period has passed
      if (moisturePercent < moistureThreshold && (currentMillis - lastWateringTime >= AUTO_COOLDOWN_MS)) {
        setPump(true);
      }
    }
  }

  // 5. Periodic Telemetry to Web Dashboard
  if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = currentMillis;
    sendTelemetry(moisturePercent, rawValue);
  }
}

