// AI was used to help program this file

#include <WiFi.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>

// ===== CONFIG =====
const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";

const char* mqttServer = "YOUR_SERVER_IP";
const int   mqttPort   = 1883;
const char* mqttTopic  = "ble/presence";

const int scanTime = 5;                     // seconds
const unsigned long SEND_INTERVAL = 3000;   // ms

// ===== GLOBALS =====
WiFiClient espClient;
PubSubClient mqtt(espClient);

NimBLEScan* pBLEScan;
volatile bool deviceDetected = false;
unsigned long lastSend = 0;

// ===== BLE CALLBACK =====
class MyAdvertisedDeviceCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* d) override {
    if (d->getRSSI() >= -80) {               // relaxed threshold
      deviceDetected = true;
    }
  }
};

// ===== MQTT CONNECT =====
void reconnectMQTT() {
  while (!mqtt.connected()) {
    mqtt.connect("esp32-ble-scanner");
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);

  // WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");

  // MQTT
  mqtt.setServer(mqttServer, mqttPort);

  // BLE
  NimBLEDevice::init("");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

  pBLEScan = NimBLEDevice::getScan();
  pBLEScan->setScanCallbacks(new MyAdvertisedDeviceCallbacks());
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(100);                  // 100% duty cycle
  pBLEScan->setDuplicateFilter(false);
}

// ===== LOOP =====
void loop() {
  if (!mqtt.connected()) {
    reconnectMQTT();
  }
  mqtt.loop();

  deviceDetected = false;

  pBLEScan->clearResults();
  pBLEScan->start(scanTime, false);

  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL) {
    mqtt.publish(mqttTopic, deviceDetected ? "1" : "0", true);
    lastSend = now;
  }

  delay(1000);
}
