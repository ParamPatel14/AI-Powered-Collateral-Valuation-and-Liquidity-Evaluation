import * as L from 'leaflet'
import 'leaflet-draw/dist/leaflet.draw.js'

const Draw = (L as unknown as { Draw?: unknown }).Draw

export { Draw }
export default Draw

