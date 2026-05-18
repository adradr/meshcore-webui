import { TileLayer } from "react-leaflet"

interface Props {
  dark: boolean
}

const LIGHT_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const LIGHT_ATTR = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const DARK_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
const DARK_ATTR =
  '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

export function ThemedTileLayer({ dark }: Props) {
  return dark ? (
    <TileLayer url={DARK_URL} attribution={DARK_ATTR} subdomains="abcd" maxZoom={20} />
  ) : (
    <TileLayer url={LIGHT_URL} attribution={LIGHT_ATTR} maxZoom={19} />
  )
}
