// for the bluetooth scanning
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

int scanTime = 10; // seconds
BLEScan* pBLEScan;

// Callback class for detected BLE devices
class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    int rssi = advertisedDevice.getRSSI();

    // Only process devices stronger than -60 dBm
    if (rssi >= -60) {
      Serial.print("Device found: ");

      if (advertisedDevice.haveName()) {
        Serial.print(advertisedDevice.getName().c_str());
      } else {
        Serial.print("Unknown | ");
      }
      Serial.print("");
      Serial.print(advertisedDevice.getAddress().toString().c_str());
      Serial.print(" | RSSI: ");
      Serial.println(rssi);
    }
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting BLE scan...");

  BLEDevice::init("");

  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
  pBLEScan->setActiveScan(true);  // request more info from devices
}

void loop() {
  Serial.println("Scanning...");
  pBLEScan->start(scanTime, false); // scan for scanTime seconds
  Serial.println("Scan done!\n");
  delay(2000); // wait 2 seconds before scanning again
}
