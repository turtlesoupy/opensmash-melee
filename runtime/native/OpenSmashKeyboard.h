#pragma once
#include "InputCommon/ControllerInterface/CoreDevice.h"
#include "OpenSmashInput.h"
namespace OpenSmashInput {
class Keyboard final : public ciface::Core::Device {
  class KeyInput final : public Input {
    std::string name;
    unsigned code;

  public:
    KeyInput(const char *label, unsigned value) : name(label), code(value) {}
    std::string GetName() const override { return name; }
    ControlState GetState() const override { return Key(code) ? 1.0 : 0.0; }
  };

public:
  Keyboard() {
    for (auto entry : {std::pair{"A", 0u},
                       {"S", 1u},
                       {"D", 2u},
                       {"F", 3u},
                       {"H", 4u},
                       {"G", 5u},
                       {"Q", 12u},
                       {"W", 13u},
                       {"E", 14u},
                       {"T", 17u},
                       {"O", 31u},
                       {"U", 32u},
                       {"I", 34u},
                       {"Return", 36u},
                       {"J", 38u},
                       {"K", 40u},
                       {"Space", 49u},
                       {"Left Arrow", 123u},
                       {"Right Arrow", 124u},
                       {"Down Arrow", 125u},
                       {"Up Arrow", 126u}})
      AddInput(new KeyInput(entry.first, entry.second));
  }
  std::string GetName() const override { return "Keyboard"; }
  std::string GetSource() const override { return "OpenSmash"; }
};
} // namespace OpenSmashInput
