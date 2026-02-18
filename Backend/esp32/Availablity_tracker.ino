#define MQTT_MAX_PACKET_SIZE 512

#include <WiFi.h>
#include <PubSubClient.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <Preferences.h>

/* ========= CONFIG ========= */
const char* roomName = "AIEB";
const int roomID = 216;

const char* mqttServer = "192.168.1.8";
const int mqttPort = 1883;
const char* mqttTopic = "ble/presence";

int rssiThreshold = -75;
int scanTime = 5; // seconds

#define RESET_BUTTON 0          // BOOT button on most ESP32 boards
#define RESET_HOLD_TIME 3000    // 3 seconds hold to erase WiFi

/* ========= GLOBALS ========= */
WiFiClient espClient;
PubSubClient mqttClient(espClient);
BLEScan* pBLEScan;

Preferences preferences;
String savedSSID;
String savedPassword;

bool deviceDetected = false;
bool occupancySent = false;

/* ========= CREDENTIAL RESET ========= */
void checkForCredentialReset() {
    pinMode(RESET_BUTTON, INPUT_PULLUP);

    if (digitalRead(RESET_BUTTON) == LOW) {
        Serial.println("Hold BOOT button to clear WiFi credentials...");

        unsigned long startTime = millis();
        while (digitalRead(RESET_BUTTON) == LOW) {
            if (millis() - startTime > RESET_HOLD_TIME) {
                Serial.println("Clearing saved WiFi credentials...");

                preferences.begin("wifi", false);
                preferences.clear();   // ERASE STORED DATA
                preferences.end();

                Serial.println("Credentials cleared. Restarting...");
                delay(1000);
                ESP.restart();
            }
        }
    }
}

/* ========= WIFI ========= */
void setupWiFi() {
    preferences.begin("wifi", false);

    savedSSID = preferences.getString("ssid", "");
    savedPassword = preferences.getString("pass", "");

    bool useSavedCreds = false;

    // If saved credentials exist, ask user if they want to use them
    if (savedSSID != "") {
        Serial.println("\n====================================");
        Serial.println("  Saved WiFi Credentials Found");
        Serial.println("====================================");
        Serial.print("SSID: ");
        Serial.println(savedSSID);
        Serial.print("Password: ");
        
        // Mask password for security (show first 2 and last 2 chars)
        if (savedPassword.length() > 4) {
            Serial.print(savedPassword.substring(0, 2));
            for (int i = 0; i < savedPassword.length() - 4; i++) {
                Serial.print("*");
            }
            Serial.println(savedPassword.substring(savedPassword.length() - 2));
        } else {
            // For short passwords, just show asterisks
            for (int i = 0; i < savedPassword.length(); i++) {
                Serial.print("*");
            }
            Serial.println();
        }
        
        Serial.println("====================================");
        Serial.println("Use saved credentials? (y/n)");
        
        // Clear serial buffer
        while (Serial.available()) {
            Serial.read();
        }
        
        // Wait for user input
        while (!Serial.available()) {
            delay(100);
        }
        
        String response = Serial.readStringUntil('\n');
        response.trim();
        response.toLowerCase();
        
        if (response == "y" || response == "yes") {
            useSavedCreds = true;
            Serial.println("✓ Using saved credentials...");
        } else {
            useSavedCreds = false;
            Serial.println("✓ Entering new credentials...");
        }
    }

    // Enter new credentials if needed
    if (!useSavedCreds) {
        Serial.println("\n====================================");
        Serial.println("     Enter WiFi Credentials");
        Serial.println("====================================");
        
        // Clear serial buffer
        while (Serial.available()) {
            Serial.read();
        }
        
        Serial.println("Enter SSID:");
        while (!Serial.available()) {
            delay(100);
        }
        savedSSID = Serial.readStringUntil('\n');
        savedSSID.trim();
        
        // Clear serial buffer
        while (Serial.available()) {
            Serial.read();
        }

        Serial.println("Enter Password:");
        while (!Serial.available()) {
            delay(100);
        }
        savedPassword = Serial.readStringUntil('\n');
        savedPassword.trim();

        // Save new credentials
        preferences.putString("ssid", savedSSID);
        preferences.putString("pass", savedPassword);
        Serial.println("✓ New credentials saved!");
    }

    preferences.end();

    // Connect to WiFi
    Serial.println("====================================");
    WiFi.mode(WIFI_STA);
    WiFi.begin(savedSSID.c_str(), savedPassword.c_str());

    Serial.print("Connecting to WiFi");
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n WiFi connected!");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
        Serial.println("====================================\n");
    } else {
        Serial.println("\n WiFi connection failed!");
        Serial.println("Restarting to try again...");
        Serial.println("====================================\n");
        delay(2000);
        ESP.restart();
    }
}

/* ========= MQTT ========= */
void connectToMQTT() {
    while (!mqttClient.connected()) {
        Serial.print("Connecting to MQTT...");
        if (mqttClient.connect("ESP32-Presence")) {
            Serial.println("connected");
        } else {
            Serial.print("failed, rc=");
            Serial.println(mqttClient.state());
            delay(5000);
        }
    }
}

/* ========= BLE SCAN ========= */
void scanBLE() {

    if (!pBLEScan) {
        Serial.println("ERROR: BLE scan not initialized");
        return;
    }

    Serial.println("\n========================================");
    Serial.println("Starting BLE scan...");
    BLEScanResults* results = pBLEScan->start(scanTime, false);

    if (!results) {
        Serial.println("BLE scan returned null");
        return;
    }

    int count = results->getCount();
    deviceDetected = false;
    int strongDevices = 0;

    // Count and collect strong devices first
    for (int i = 0; i < count; i++) {
        BLEAdvertisedDevice device = results->getDevice(i);
        int rssi = device.getRSSI();

        if (rssi >= rssiThreshold) {
            deviceDetected = true;
            strongDevices++;
        }
    }

    // Print summary
    Serial.print("Total Devices Found: ");
    Serial.println(count);
    Serial.print("Devices Above Threshold: ");
    Serial.println(strongDevices);
    
    // Print results header
    if (strongDevices > 0) {
        Serial.println("\nResults:");
        
        // Now print the strong devices
        for (int i = 0; i < count; i++) {
            BLEAdvertisedDevice device = results->getDevice(i);
            int rssi = device.getRSSI();
            String address = device.getAddress().toString().c_str();

            if (rssi >= rssiThreshold) {
                Serial.print("  ");
                Serial.print(address);
                Serial.print(" | RSSI: ");
                Serial.println(rssi);
            }
        }
    } else {
        Serial.println("\nResults: None");
    }

    // Prevent memory leak in classic BLE
    pBLEScan->clearResults();
}


/* ========= SETUP ========= */
void setup() {

    Serial.begin(115200);
    delay(2000);
    Serial.println("Booting...");

    // Check if user wants to erase credentials
    checkForCredentialReset();

    // Initialize BLE FIRST
    Serial.println("Initializing BLE...");
    BLEDevice::init("");
    pBLEScan = BLEDevice::getScan();

    if (pBLEScan == nullptr) {
        Serial.println("ERROR: Failed to create BLE scan object");
        ESP.restart();
    }

    pBLEScan->setActiveScan(true);
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(99);

    Serial.println("BLE initialized successfully");

    // Initialize WiFi after BLE
    setupWiFi();

    mqttClient.setServer(mqttServer, mqttPort);
    mqttClient.setBufferSize(MQTT_MAX_PACKET_SIZE);
}

/* ========= LOOP ========= */
void loop() {

    if (!mqttClient.connected()) connectToMQTT();
    mqttClient.loop();

    scanBLE();

    if (deviceDetected && mqttClient.connected() && !occupancySent) {

        char payload[128];
        sprintf(payload,
                "{\"roomName\":\"%s\",\"roomID\":%d,\"status\":1}",
                roomName, roomID);

        mqttClient.publish(mqttTopic, payload, true);

        Serial.print("MQTT published: ");
        Serial.println(payload);

        occupancySent = true;
    }

    // Reset occupancy every 20 seconds
    static unsigned long lastReset = 0;
    if (millis() - lastReset > 20000) {
        occupancySent = false;
        lastReset = millis();
    }

    delay(60000);
};
