import { Download, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TypenameOption } from "@/features/rx_log/format"

export interface RxToolbarProps {
  search: string
  setSearch: (v: string) => void
  routeFilter: string
  setRouteFilter: (v: string) => void
  payloadFilter: string
  setPayloadFilter: (v: string) => void
  routeOptions: TypenameOption[]
  payloadOptions: TypenameOption[]
  paused: boolean
  setPaused: (v: boolean) => void
  filteredCount: number
  total: number
  onExportCsv: () => void
  onExportJson: () => void
}

export function RxToolbar({
  search,
  setSearch,
  routeFilter,
  setRouteFilter,
  payloadFilter,
  setPayloadFilter,
  routeOptions,
  payloadOptions,
  paused,
  setPaused,
  filteredCount,
  total,
  onExportCsv,
  onExportJson,
}: RxToolbarProps) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background p-2">
      <div className="relative min-w-[180px] flex-1">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search"
          placeholder="Search hash, hex, payload…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <Select value={routeFilter} onValueChange={setRouteFilter}>
        <SelectTrigger aria-label="Route type filter" className="w-[160px]">
          <SelectValue placeholder="Route" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All ({total})</SelectItem>
          {routeOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={payloadFilter} onValueChange={setPayloadFilter}>
        <SelectTrigger aria-label="Payload type filter" className="w-[180px]">
          <SelectValue placeholder="Payload" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All ({total})</SelectItem>
          {payloadOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={paused}
          onCheckedChange={setPaused}
          aria-label="Pause stream"
        />
        <span>Pause stream</span>
      </label>
      <Button type="button" size="sm" variant="outline" onClick={onExportCsv}>
        <Download className="mr-1 h-4 w-4" />
        CSV
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onExportJson}>
        <Download className="mr-1 h-4 w-4" />
        JSON
      </Button>
      <Badge variant="secondary" className="ml-auto tabular-nums">
        {filteredCount} of {total}
      </Badge>
    </div>
  )
}
