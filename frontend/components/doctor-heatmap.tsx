"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"

interface DoctorHeatmapPatient {
  id: string
  demographics?: { name?: string }
  gps?: { lat?: number; lng?: number }
  ai?: { risk_score?: number }
  sample_id?: string
}

interface DoctorHeatmapProps {
  patients: DoctorHeatmapPatient[]
}

export default function DoctorHeatmap({ patients }: DoctorHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true }).setView([21.1458, 79.0882], 11)
    mapRef.current = map

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const layer = layerRef.current
    const map = mapRef.current
    if (!layer || !map) return

    layer.clearLayers()
    const bounds: [number, number][] = []

    patients
      .filter((p) => typeof p.gps?.lat === "number" && typeof p.gps?.lng === "number")
      .forEach((p) => {
        const score = p.ai?.risk_score ?? 0
        const color = score >= 8 ? "#ef4444" : score >= 4 ? "#f59e0b" : "#10b981"
        const lat = p.gps!.lat!
        const lng = p.gps!.lng!
        bounds.push([lat, lng])

        const icon = L.divIcon({
          className: "tb-person-pin",
          html: `<div style="
              width: 26px;
              height: 26px;
              border-radius: 9999px;
              background: ${color};
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 14px;
              border: 2px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,.35);
            ">👤</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -10],
        })

        L.marker([lat, lng], { icon })
          .bindPopup(
            `<div style="font-size:12px;">
              <div><strong>${p.demographics?.name || "Unknown"}</strong></div>
              <div>Sample: ${p.sample_id || "-"}</div>
              <div>Risk: ${score}</div>
            </div>`
          )
          .addTo(layer)
      })

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 13, { animate: true })
    }
  }, [patients])

  return <div ref={containerRef} className="h-full w-full" />
}
