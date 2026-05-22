/**
 * ProfileCard tests — verify it renders every preset in the region,
 * fires onChange with the preset id on click, and shows the airtime
 * estimate.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ProfileCard } from "../ProfileCard"
import { presetsByRegion } from "../../radioPresets"

const EU_PRESETS = presetsByRegion().EU

describe("ProfileCard", () => {
  it("renders one tile per preset", () => {
    render(
      <ProfileCard
        presets={EU_PRESETS}
        selectedId={EU_PRESETS[0].id}
        onChange={() => {}}
      />,
    )
    for (const preset of EU_PRESETS) {
      expect(screen.getByTestId(`profile-tile-${preset.id}`)).toBeTruthy()
    }
  })

  it("shows humanLabel, description, and details for each preset", () => {
    render(
      <ProfileCard
        presets={EU_PRESETS}
        selectedId={EU_PRESETS[0].id}
        onChange={() => {}}
      />,
    )
    for (const preset of EU_PRESETS) {
      const tile = screen.getByTestId(`profile-tile-${preset.id}`)
      expect(tile.textContent).toContain(preset.humanLabel)
      expect(tile.textContent).toContain(preset.description)
      const details = screen.getByTestId(`profile-details-${preset.id}`)
      expect(details.textContent).toMatch(new RegExp(`${preset.freq}`))
    }
  })

  it("renders an airtime estimate for each preset", () => {
    render(
      <ProfileCard
        presets={EU_PRESETS}
        selectedId={EU_PRESETS[0].id}
        onChange={() => {}}
      />,
    )
    for (const preset of EU_PRESETS) {
      const airtime = screen.getByTestId(`profile-airtime-${preset.id}`)
      expect(airtime.textContent ?? "").toMatch(/100\s*B/i)
      expect(airtime.textContent ?? "").toMatch(/(ms|s)/)
    }
  })

  it("fires onChange with the preset id when a tile is clicked", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ProfileCard
        presets={EU_PRESETS}
        selectedId={EU_PRESETS[0].id}
        onChange={onChange}
      />,
    )
    // Click the second preset's tile
    const target = EU_PRESETS[1]
    const tile = screen.getByTestId(`profile-tile-${target.id}`)
    await user.click(tile)
    expect(onChange).toHaveBeenCalledWith(target.id)
  })

  it("marks the selected preset as checked", () => {
    render(
      <ProfileCard
        presets={EU_PRESETS}
        selectedId={EU_PRESETS[0].id}
        onChange={() => {}}
      />,
    )
    const radio = screen.getByRole("radio", { name: EU_PRESETS[0].humanLabel })
    expect(
      radio.getAttribute("data-state") === "checked" ||
        radio.getAttribute("aria-checked") === "true",
    ).toBe(true)
  })
})
