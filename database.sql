create database dbesp32;

use dbesp32;

create table tblUsers (
	userID INT auto_increment,
    Email varchar(255) NOT NULL,
    passwordHash varchar(255) NOT NULL,
    Role varchar(20) NOT NULL DEFAULT 'viewer',
    Major varchar(50) NOT NULL,
    primary key (userID)
);

create table tblBuildings (
	buildingID INT auto_increment,
    buildingName varchar(255) NOT NULL,
    buildingCode varchar(32) NOT NULL,
    primary key (buildingID)
);

create table tblstudyRooms (
	roomID INT auto_increment,
    buildingID INT NOT NULL,
    roomName varchar(255) NOT NULL,
    floorNumber INT,
    scannerID varchar (64),
    createdAt datetime NOT NULL default current_timestamp,
    primary key (roomID)
);

create table tblroomStatus (
	roomID INT NOT NULL,
    isOccupied BOOLEAN NOT NULL,
    enteredAt datetime,
    lastSeenat datetime,
    updatedAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    primary key(roomID)
);

create table tblRoomhistory (
	historyID INT auto_increment,
    roomID INT NOT NULL,
    isOccupied BOOLEAN NOT NULL,
    startedAt DATETIME NOT NULL DEFAULT current_timestamp,
    endedAt datetime,
    Cause varchar(255),
    primary key(historyID)
);