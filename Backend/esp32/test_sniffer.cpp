// This is SAMPLE CODE that still needs to be refined, but it does work
// Simple mockup of code that detects bluetooth signals

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

int scanTime = 5; // Scan duration in seconds
BLEScan* pBLEScan;

// Callback class for detected BLE devices
class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) {
    Serial.print("Device found: ");
    Serial.print(advertisedDevice.getAddress().toString().c_str());

    if (advertisedDevice.haveName()) {
      Serial.print(" | Name: ");
      Serial.print(advertisedDevice.getName().c_str());
    }

    Serial.print(" | RSSI: ");
    Serial.println(advertisedDevice.getRSSI());
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting BLE scan");

  BLEDevice::init("ESP32_BLE_Scanner");

  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
  pBLEScan->setActiveScan(true);   // Active scan uses more power but gets more data
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);         // Less than or equal to interval
}

void loop() {
  Serial.println("Scanning...");
  BLEScanResults results = pBLEScan->start(scanTime, false);
  Serial.print("Devices found: ");
  Serial.println(results.getCount());
  Serial.println("Scan done!\n");

  pBLEScan->clearResults(); // Free memory
  delay(2000);
}
