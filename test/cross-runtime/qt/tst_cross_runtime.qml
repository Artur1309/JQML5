import QtQuick 2.15
import QtTest 1.3
import "../scenario"

TestCase {
  name: "CrossRuntime"
  when: windowShown
  width: 400
  height: 300

  Scenario {
    id: scenario
    anchors.fill: parent
  }

  function readArg(name, fallbackValue) {
    var args = Qt.application.arguments
    for (var i = 0; i < args.length - 1; i += 1) {
      if (args[i] === name) {
        return args[i + 1]
      }
    }
    return fallbackValue
  }

  function runInputSequence(keys) {
    mouseClick(scenario, 80, 80, Qt.LeftButton, Qt.NoModifier, 25)
    wait(20)

    for (var i = 0; i < keys.length; i += 1) {
      keyClick(keys.charAt(i))
      wait(10)
    }
  }

  function test_cross_runtime_trace_and_snapshot() {
    var screenshotPath = readArg("--screenshot", "")
    var keys = readArg("--keys", "AB")

    runInputSequence(keys)
    wait(30)

    compare(scenario.clickCount, 1)
    compare(scenario.keyTrace, keys)

    console.log("[CROSS] final " + scenario.stateText)

    if (screenshotPath !== "") {
      var snapshot = grabImage(scenario)
      verify(snapshot.save(screenshotPath), "Unable to save screenshot: " + screenshotPath)
      console.log("[CROSS] screenshot " + screenshotPath)
    }
  }
}
