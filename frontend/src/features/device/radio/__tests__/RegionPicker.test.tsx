/**
 * RegionPicker tests — verify the shadcn Select renders the provided
 * regions and fires onChange with the picked value.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RegionPicker } from "../RegionPicker"
import type { Region } from "../../radioPresets"

const ALL_REGIONS: readonly Region[] = ["EU", "US", "AU", "KR", "IN", "HK", "Global"]

describe("RegionPicker", () => {
  it("shows a placeholder when value is null", () => {
    render(<RegionPicker regions={ALL_REGIONS} value={null} onChange={() => {}} />)
    expect(screen.getByText(/pick a region/i)).toBeTruthy()
  })

  it("renders the trigger with the current region label when set", () => {
    render(<RegionPicker regions={ALL_REGIONS} value="US" onChange={() => {}} />)
    // SelectValue collapses to the selected option's text inside the trigger
    const trigger = screen.getByTestId("region-picker-trigger")
    expect(trigger.textContent).toMatch(/US/)
  })

  it("opens the dropdown and fires onChange with the chosen region", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RegionPicker
        regions={ALL_REGIONS}
        value="EU"
        onChange={onChange}
      />,
    )
    await user.click(screen.getByTestId("region-picker-trigger"))
    const usItem = await screen.findByTestId("region-item-US")
    await user.click(usItem)
    expect(onChange).toHaveBeenCalledWith("US")
  })

  it("only lists the regions passed in via props", async () => {
    const user = userEvent.setup()
    render(
      <RegionPicker
        regions={["EU", "US"]}
        value="EU"
        onChange={() => {}}
      />,
    )
    await user.click(screen.getByTestId("region-picker-trigger"))
    expect(await screen.findByTestId("region-item-EU")).toBeTruthy()
    expect(screen.getByTestId("region-item-US")).toBeTruthy()
    expect(screen.queryByTestId("region-item-AU")).toBeNull()
  })

  it("respects the disabled prop", () => {
    render(
      <RegionPicker
        regions={ALL_REGIONS}
        value="EU"
        onChange={() => {}}
        disabled
      />,
    )
    const trigger = screen.getByTestId("region-picker-trigger")
    expect(trigger.getAttribute("data-disabled") !== null ||
      trigger.hasAttribute("disabled")).toBe(true)
  })
})
