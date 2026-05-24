import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { IntervalSlider } from "../TraceMonitorPanelParts"

describe("IntervalSlider", () => {
  it("renders the value in big format with the right unit", () => {
    render(<IntervalSlider value={10} onChange={() => {}} disabled={false} />)
    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByText("sec")).toBeInTheDocument()
  })

  it("renders minutes when value is a clean multiple of 60", () => {
    render(<IntervalSlider value={60} onChange={() => {}} disabled={false} />)
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("min")).toBeInTheDocument()
  })

  it("renders mixed values without a unit suffix", () => {
    // 65s should not silently round; we surface "1m 5s".
    render(<IntervalSlider value={65} onChange={() => {}} disabled={false} />)
    expect(screen.getByText("1m 5s")).toBeInTheDocument()
  })

  it("clicking a preset chip emits the matching seconds value", () => {
    const onChange = vi.fn()
    render(<IntervalSlider value={5} onChange={onChange} disabled={false} />)
    fireEvent.click(screen.getByRole("radio", { name: "30s" }))
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it("marks the matching preset as aria-checked when value equals it", () => {
    render(<IntervalSlider value={60} onChange={() => {}} disabled={false} />)
    expect(screen.getByRole("radio", { name: "1m" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("radio", { name: "5s" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })

  it("disables every preset chip when disabled prop is true", () => {
    render(<IntervalSlider value={5} onChange={() => {}} disabled={true} />)
    for (const chip of screen.getAllByRole("radio")) {
      expect(chip).toBeDisabled()
    }
  })
})
