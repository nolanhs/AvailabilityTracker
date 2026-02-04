#include <WiFi.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>

/* ========= CONFIG ========= */

// WiFi
const char* ssid = "Luke's wifi";
const char* password = "GoGoEagle#4812";

// MQTT broker (PC running Mosquitto)
const char* mqttServer = "192.168.1.6";   // CHANGE if needed
const int mqttPort = 1883;
const char* mqttTopic = "ble/presence";

// BLE
int scanTime = 10;          // seconds
int rssiThreshold = -60;

/* ========= GLOBALS ========= */

WiFiClient espClient;
PubSubClient mqttClient(espClient);

NimBLEScan* pBLEScan;
bool occupancySent = false;

/* ========= MQTT ========= */

void connectToMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT...");
    if (mqttClient.connect("ESP32-Presence")) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 5s");
      delay(5000);
    }
  }
}

/* ========= BLE CALLBACK ========= */

class MyScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) override {
    int rssi = device->getRSSI();

    if (rssi >= rssiThreshold && !occupancySent) {
      Serial.print("BLE device detected | RSSI: ");
      Serial.println(rssi);

      const char* payload = "1";   // presence detected
      mqttClient.publish(mqttTopic, payload, true);

      Serial.println("MQTT published: ble/presence = 1");
      occupancySent = true;
    }
  }
};

/* ========= SETUP ========= */

void setup() {
  Serial.begin(115200);

  /* WiFi */
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");

  /* MQTT */
  mqttClient.setServer(mqttServer, mqttPort);
  connectToMQTT();

  /* BLE */
  NimBLEDevice::init("");
  pBLEScan = NimBLEDevice::getScan();
  pBLEScan->setScanCallbacks(new MyScanCallbacks());
  pBLEScan->setActiveScan(false);
}

/* ========= LOOP ========= */

void loop() {
  if (!mqttClient.connected()) {
    connectToMQTT();
  }
  mqttClient.loop();

  occupancySent = false;

  Serial.println("Scanning BLE...");
  pBLEScan->start(scanTime, false);
  Serial.println("Scan done");

  delay(60000);  // scan every minute
}
