"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"

interface DoctorHeatmapPatient {
  id: string
  demographics?: { name?: string }
  gps?: { lat?: number; lng?: number }
  ai?: { risk_score?: number }
  sample_id?: string
  facility_name?: string
}

interface DoctorHeatmapProps {
  patients: DoctorHeatmapPatient[]
  profileBasePath?: string
  showFacility?: boolean
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function normalizeName(name?: string): string {
  if (!name) return "Unknown"
  return name.replace(/\s+\d+$/, "")
}

export default function DoctorHeatmap({
  patients,
  profileBasePath = "/doctor/patient",
  showFacility = false,
}: DoctorHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const lastBoundsKeyRef = useRef<string>("")

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      preferCanvas: true,
      zoomControl: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    }).setView([21.1458, 79.0882], 11)
    mapRef.current = map

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
      updateWhenIdle: true,
      keepBuffer: 4,
      detectRetina: true,
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
        const safeName = escapeHtml(normalizeName(p.demographics?.name))
        const safeFacility = escapeHtml(p.facility_name || "-")
        const profileUrl = `${profileBasePath}/${encodeURIComponent(p.id)}`
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
              <div><strong>${safeName}</strong></div>
              <div>Sample: ${p.sample_id || "-"}</div>
              <div>Risk: ${score}</div>
              ${showFacility ? `<div>Facility: ${safeFacility}</div>` : ""}
              <div style="margin-top:6px;">
                <a href="${profileUrl}" style="color:#0f766e; font-weight:600; text-decoration:underline;">Open Profile</a>
              </div>
            </div>`
          )
          .addTo(layer)
      })

    const boundsKey = bounds
      .map(([lat, lng]) => `${lat.toFixed(4)},${lng.toFixed(4)}`)
      .sort()
      .join("|")

    if (bounds.length > 1 && boundsKey !== lastBoundsKeyRef.current) {
      lastBoundsKeyRef.current = boundsKey
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 })
    } else if (bounds.length === 1 && boundsKey !== lastBoundsKeyRef.current) {
      lastBoundsKeyRef.current = boundsKey
      map.setView(bounds[0], 13, { animate: true })
    }
  }, [patients])

  return <div ref={containerRef} className="h-full w-full" />
}
