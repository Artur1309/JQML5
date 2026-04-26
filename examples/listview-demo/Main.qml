import QtQuick 2.15

Item {
    id: root
    width: 480
    height: 640

    // -----------------------------------------------------------------------
    // Model
    // -----------------------------------------------------------------------
    ListModel {
        id: contactsModel
        ListElement { name: "Alice";  city: "Berlin";    age: 30 }
        ListElement { name: "Bob";    city: "Paris";     age: 25 }
        ListElement { name: "Carol";  city: "London";    age: 35 }
        ListElement { name: "Dave";   city: "Tokyo";     age: 28 }
        ListElement { name: "Eve";    city: "New York";  age: 22 }
        ListElement { name: "Frank";  city: "Sydney";    age: 40 }
        ListElement { name: "Grace";  city: "Moscow";    age: 33 }
        ListElement { name: "Heidi";  city: "Rome";      age: 27 }
        ListElement { name: "Ivan";   city: "Seoul";     age: 31 }
        ListElement { name: "Judy";   city: "Mumbai";    age: 29 }
    }

    // -----------------------------------------------------------------------
    // Title bar
    // -----------------------------------------------------------------------
    Rectangle {
        id: titleBar
        width: root.width
        height: 50
        color: "#3f51b5"

        Text {
            x: 16
            y: 14
            text: "Contacts  —  current: " + (listView.currentIndex >= 0 ? listView.currentIndex : "none")
            color: "#ffffff"
            font.pixelSize: 16
        }
    }

    // -----------------------------------------------------------------------
    // ListView with header, footer, highlight and keyboard navigation
    // reuseItems: toggled by the button in the action bar.
    // onPooled / onReused: log to console to verify delegate reuse lifecycle.
    // Delegate text shows: index / model.index / modelData.name
    // -----------------------------------------------------------------------
    ListView {
        id: listView
        x: 0
        y: 50
        width: root.width
        height: root.height - 110

        focus: true
        model: contactsModel

        // reuseItems=false by default (matches desktop QtQuick).
        // Toggle with the "Reuse: ON/OFF" button below.
        reuseItems: false

        onPooled: function(item, index) {
            console.log("pooled  item at index", index)
        }
        onReused: function(item, index) {
            console.log("reused  item now at index", index)
        }

        // ----- header -------------------------------------------------------
        header: Rectangle {
            width: listView.width
            height: 36
            color: "#e8eaf6"

            Text {
                x: 16; y: 9
                text: listView.count + " contacts  |  reuseItems: " + listView.reuseItems
                color: "#3f51b5"
                font.pixelSize: 13
            }
        }

        // ----- footer -------------------------------------------------------
        footer: Rectangle {
            width: listView.width
            height: 32
            color: "#e8eaf6"

            Text {
                x: 16; y: 8
                text: listView.atYEnd ? "— end of list —" : "scroll for more…"
                color: "#888888"
                font.pixelSize: 12
            }
        }

        // ----- highlight (rendered behind delegates) -----------------------
        highlight: Rectangle {
            width: listView.width
            color: "#c5cae9"
        }
        highlightFollowsCurrentItem: true

        // ----- delegate -----------------------------------------------------
        delegate: Rectangle {
            width: listView.width
            height: 56
            color: "transparent"
            borderColor: "#e0e0e0"
            borderWidth: 1

            // Avatar circle
            Rectangle {
                x: 12
                y: 8
                width: 40
                height: 40
                color: listView.currentIndex === index ? "#3f51b5" : "#9fa8da"
                radius: 20

                Text {
                    x: 12; y: 10
                    text: name.charAt(0)
                    color: "#ffffff"
                    font.pixelSize: 16
                }
            }

            // Name + city
            Text {
                x: 64; y: 10
                text: name
                color: "#1a1a2e"
                font.pixelSize: 15
            }
            // Shows index / model.index / modelData.name for context-parity verification
            Text {
                x: 64; y: 30
                text: city + ", age " + age + "  [" + index + " / " + model.index + " / " + modelData.name + "]"
                color: "#666666"
                font.pixelSize: 12
            }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    listView.currentIndex = index
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Bottom action bar
    // -----------------------------------------------------------------------
    Rectangle {
        id: actionBar
        x: 0
        y: root.height - 60
        width: root.width
        height: 60
        color: "#fafafa"
        borderColor: "#e0e0e0"
        borderWidth: 1

        // "Add" button
        Rectangle {
            id: addButton
            x: 16
            y: 10
            width: 80
            height: 40
            color: "#4caf50"
            radius: 4

            Text { x: 22; y: 12; text: "Add"; color: "#fff"; font.pixelSize: 13 }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    contactsModel.append({
                        name: "New",
                        city: "Unknown",
                        age: 0
                    })
                }
            }
        }

        // "Remove" button
        Rectangle {
            x: 104
            y: 10
            width: 80
            height: 40
            color: "#f44336"
            radius: 4

            Text { x: 12; y: 12; text: "Remove"; color: "#fff"; font.pixelSize: 13 }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    if (listView.currentIndex >= 0) {
                        contactsModel.remove(listView.currentIndex)
                    }
                }
            }
        }

        // "Reset" button
        Rectangle {
            x: 192
            y: 10
            width: 80
            height: 40
            color: "#ff9800"
            radius: 4

            Text { x: 18; y: 12; text: "Reset"; color: "#fff"; font.pixelSize: 13 }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    contactsModel.clear()
                    contactsModel.append({ name: "Alice", city: "Berlin", age: 30 })
                    contactsModel.append({ name: "Bob",   city: "Paris",  age: 25 })
                    contactsModel.append({ name: "Carol", city: "London", age: 35 })
                    listView.currentIndex = 0
                }
            }
        }

        // "Reuse: ON/OFF" toggle button
        Rectangle {
            x: 280
            y: 10
            width: 90
            height: 40
            color: listView.reuseItems ? "#607d8b" : "#9e9e9e"
            radius: 4

            Text {
                x: 8; y: 12
                text: "Reuse: " + (listView.reuseItems ? "ON" : "OFF")
                color: "#fff"
                font.pixelSize: 12
            }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    listView.reuseItems = !listView.reuseItems
                }
            }
        }

        // "▼ Next" button
        Rectangle {
            x: 378
            y: 10
            width: 88
            height: 40
            color: "#607d8b"
            radius: 4

            Text { x: 8; y: 12; text: "▲▼ Nav"; color: "#fff"; font.pixelSize: 12 }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    if (listView.currentIndex < listView.count - 1)
                        listView.currentIndex = listView.currentIndex + 1
                    else if (listView.currentIndex > 0)
                        listView.currentIndex = listView.currentIndex - 1
                }
            }
        }
    }
}
