#define MQTT_MAX_PACKET_SIZE 256

#include <WiFi.h>
#include <PubSubClient.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <Preferences.h>

/* ========= CONFIG ========= */
const char* roomName = "AIEB";
const int roomID = 216;

const char* mqttServer = "35.243.237.220"; // needs to change based on local host
const int mqttPort = 1883;
const char* mqttTopic = "eaglevision/sensors";

const char* SERVER_URL = "http://35.243.237.220:8080/api/occupancy";

int rssiThreshold = -65;
int scanTime = 5; 

#define RESET_BUTTON 0  
#define RESET_HOLD_TIME 3000
#define SERIAL_TIMEOUT 30000 

/* ========= GLOBALS ========= */
WiFiClient espClient;
PubSubClient mqttClient(espClient);
BLEScan* pBLEScan;

Preferences preferences;
String savedSSID;
String savedPassword;

bool deviceDetected = false;
int deviceCount = 0;
unsigned long lastScanTime = 0;
const unsigned long scanInterval = 60000;

/* ========= HELPER: READ SERIAL WITH TIMEOUT ========= */
// Returns true if input was received, false on timeout
bool readSerialWithTimeout(String &output, unsigned long timeout) {
    unsigned long startWait = millis();
    while (!Serial.available()) {
        if (millis() - startWait > timeout) {
            return false;
        }
        delay(100);
    }
    output = Serial.readStringUntil('\n');
    output.trim();
    return true;
}

// Flush any leftover serial data
void flushSerial() {
    while (Serial.available()) {
        Serial.read();
    }
}

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
                preferences.clear();
                preferences.end();

                Serial.println("Credentials cleared. Restarting...");
                delay(1000);
                ESP.restart();
            }
            delay(10);
        }
    }
}

/* ========= WIFI ========= */
void setupWiFi() {
    preferences.begin("wifi", false);

    savedSSID = preferences.getString("ssid", "");
    savedPassword = preferences.getString("pass", "");

    bool useSavedCreds = false;

    if (savedSSID != "") {
        Serial.println("\n====================================");
        Serial.println("  Saved WiFi Credentials Found");
        Serial.println("====================================");
        Serial.print("SSID: ");
        Serial.println(savedSSID);
        Serial.print("Password: ");

        if (savedPassword.length() > 4) {
            Serial.print(savedPassword.substring(0, 2));
            for (unsigned int i = 0; i < savedPassword.length() - 4; i++) {
                Serial.print("*");
            }
            Serial.println(savedPassword.substring(savedPassword.length() - 2));
        } else {
            for (unsigned int i = 0; i < savedPassword.length(); i++) {
                Serial.print("*");
            }
            Serial.println();
        }

        Serial.println("====================================");
        Serial.println("Use saved credentials? (y/n) [30s timeout -> yes]");

        flushSerial();

        String response;
        if (readSerialWithTimeout(response, SERIAL_TIMEOUT)) {
            response.toLowerCase();
            if (response == "y" || response == "yes") {
                useSavedCreds = true;
                Serial.println("Using saved credentials...");
            } else {
                useSavedCreds = false;
                Serial.println("Entering new credentials...");
            }
        } else {
            useSavedCreds = true;
            Serial.println("Timeout - using saved credentials...");
        }
    }

    if (!useSavedCreds) {
        Serial.println("\n====================================");
        Serial.println("     Enter WiFi Credentials");
        Serial.println("====================================");

        flushSerial();

        Serial.println("Enter SSID (30s timeout):");
        if (!readSerialWithTimeout(savedSSID, SERIAL_TIMEOUT)) {
            Serial.println("Timeout waiting for SSID. Restarting...");
            preferences.end();
            delay(1000);
            ESP.restart();
        }

        flushSerial();

        Serial.println("Enter Password (30s timeout):");
        if (!readSerialWithTimeout(savedPassword, SERIAL_TIMEOUT)) {
            Serial.println("Timeout waiting for password. Restarting...");
            preferences.end();
            delay(1000);
            ESP.restart();
        }

        preferences.putString("ssid", savedSSID);
        preferences.putString("pass", savedPassword);
        Serial.println("New credentials saved!");
    }

    preferences.end();

    Serial.println("====================================");

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);

    WiFi.begin(savedSSID.c_str(), savedPassword.c_str());

    Serial.print("Connecting to WiFi");
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi connected!");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
        Serial.println("====================================\n");
    } else {
        Serial.println("\nWiFi connection failed!");
        Serial.println("Restarting to try again...");
        Serial.println("====================================\n");
        delay(2000);
        ESP.restart();
    }
}

/* ========= MQTT ========= */
void connectToMQTT() {
    int retries = 0;
    while (!mqttClient.connected() && retries < 3) {
        Serial.print("Connecting to MQTT... ");
        String clientId = "ESP32-Presence-" + String(roomID);

        if (mqttClient.connect(clientId.c_str())) {
            Serial.println("connected");
            return;
        } else {
            Serial.print("failed, rc=");
            Serial.println(mqttClient.state());
            retries++;
            delay(2000);
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

    Serial.print("Free Heap before scan: ");
    Serial.print(ESP.getFreeHeap());
    Serial.println(" bytes");

    BLEScanResults* results = pBLEScan->start(scanTime, false);
    yield(); // Let WiFi/system tasks run after scan

    if (!results) {
        Serial.println("BLE scan returned null");
        pBLEScan->clearResults();
        return;
    }

    int count = results->getCount();
    deviceDetected = false;
    int strongDevices = 0;

    for (int i = 0; i < count; i++) {
        BLEAdvertisedDevice device = results->getDevice(i);
        int rssi = device.getRSSI();

        if (rssi >= rssiThreshold) {
            deviceDetected = true;
            strongDevices++;
        }
    }

    deviceCount = strongDevices;

    Serial.print("Total Devices Found: ");
    Serial.println(count);
    Serial.print("Devices Above Threshold (");
    Serial.print(rssiThreshold);
    Serial.print(" dBm): ");
    Serial.println(strongDevices);

    if (strongDevices > 0) {
        Serial.println("\nStrong Signals:");

        for (int i = 0; i < count; i++) {
            BLEAdvertisedDevice device = results->getDevice(i);
            int rssi = device.getRSSI();
            String address = device.getAddress().toString().c_str();

            if (rssi >= rssiThreshold) {
                Serial.print("  ");
                Serial.print(address);
                Serial.print(" | RSSI: ");
                Serial.print(rssi);
                Serial.println(" dBm");
            }
        }
    } else {
        Serial.println("No devices above threshold");
    }
    Serial.println("========================================");

    pBLEScan->clearResults();
}

/* ========= SETUP ========= */
void setup() {
    Serial.begin(115200);
    delay(2000);

    Serial.println("\n\n====================================");
    Serial.println("  ESP32 BLE Presence Detector");
    Serial.println("====================================");

    esp_reset_reason_t reason = esp_reset_reason();
    Serial.print("Reset Reason: ");
    switch (reason) {
        case ESP_RST_POWERON:   Serial.println("Power-on"); break;
        case ESP_RST_SW:        Serial.println("Software reset"); break;
        case ESP_RST_PANIC:     Serial.println("Exception/panic"); break;
        case ESP_RST_INT_WDT:   Serial.println("Interrupt watchdog"); break;
        case ESP_RST_TASK_WDT:  Serial.println("Task watchdog"); break;
        case ESP_RST_WDT:       Serial.println("Other watchdog"); break;
        case ESP_RST_DEEPSLEEP: Serial.println("Deep sleep"); break;
        case ESP_RST_BROWNOUT:  Serial.println("Brownout"); break;
        default:                Serial.println("Unknown"); break;
    }

    Serial.print("Free Heap: ");
    Serial.print(ESP.getFreeHeap());
    Serial.println(" bytes");
    Serial.println("====================================\n");

    checkForCredentialReset();

    // Step 1: WiFi
    Serial.println("Step 1/3: Initializing WiFi...");
    setupWiFi();
    delay(1000);

    // Step 2: BLE - release classic BT memory first to free RAM
    Serial.println("Step 2/3: Initializing BLE...");
    esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);

    BLEDevice::init("");
    delay(1000);

    pBLEScan = BLEDevice::getScan();

    if (pBLEScan == nullptr) {
        Serial.println("FATAL: Failed to create BLE scan object");
        delay(3000);
        ESP.restart();
    }

    pBLEScan->setActiveScan(true);
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(99);

    Serial.println("BLE initialized successfully");
    Serial.print("Free Heap after BLE: ");
    Serial.print(ESP.getFreeHeap());
    Serial.println(" bytes\n");

    // Step 3: MQTT with explicit small buffer
    Serial.println("Step 3/3: Setting up MQTT...");
    mqttClient.setServer(mqttServer, mqttPort);
    mqttClient.setBufferSize(256); // Explicit small buffer to conserve RAM
    Serial.println("MQTT configured\n");

    Serial.println("====================================");
    Serial.println("System Ready!");
    Serial.println("====================================\n");
    Serial.print("MQTT Server: ");
    Serial.println(mqttServer);
}

/* ========= LOOP ========= */
void loop() {
    // Reconnect MQTT if needed
    if (!mqttClient.connected()) {
        connectToMQTT();
    }
    mqttClient.loop();

    unsigned long currentTime = millis();

    // Run scan at the defined interval
    if (currentTime - lastScanTime >= scanInterval) {
        lastScanTime = currentTime;

        scanBLE();

        // Publish current state every scan cycle (occupied or vacant)
        if (mqttClient.connected()) {
            int status = deviceDetected ? 1 : 0;
            char payload[128];
            snprintf(payload, sizeof(payload),
                     "{\"roomName\":\"%s\",\"roomID\":%d,\"status\":%d,\"deviceCount\":%d}",
                     roomName, roomID, status, deviceCount);

            bool published = mqttClient.publish(mqttTopic, payload, true);

            if (published) {
                Serial.print("MQTT published: ");
                Serial.println(payload);
            } else {
                Serial.println("MQTT publish failed");
            }
        } else {
            Serial.println("MQTT not connected, skipping publish");
        }
    }

    delay(120);
};