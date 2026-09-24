/**
 * HDB Resale Affordability Search
 * Singapore Resale Flat Price Explorer by Budget & OneMap Visualization
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Search,
  Building2,
  MapPin,
  Calendar,
  Layers,
  ChevronRight,
  TrendingDown,
  Info,
  DollarSign,
  Filter,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Map as MapIcon,
  List,
  Home
} from 'lucide-react';

interface TownSummary {
  town: string;
  count: number;
  median: number;
  lowest: number;
  within_budget: boolean;
}

interface BlockTransaction {
  block: string;
  street_name: string;
  town: string;
  flat_type: string;
  storey_range: string;
  floor_area_sqm: number;
  remaining_lease: string;
  resale_price: number;
  month: string;
  lat?: number;
  lng?: number;
}

interface HdbApiResponse {
  towns: TownSummary[];
  blocks: BlockTransaction[];
  budget: number;
  flat_type: string | null;
  months: number;
  total_found: number;
  latest_month_analyzed?: string;
  error?: string;
}

const FLAT_TYPES = [
  { value: '', label: 'All Flat Types' },
  { value: '1 ROOM', label: '1 Room' },
  { value: '2 ROOM', label: '2 Room' },
  { value: '3 ROOM', label: '3 Room' },
  { value: '4 ROOM', label: '4 Room' },
  { value: '5 ROOM', label: '5 Room' },
  { value: 'EXECUTIVE', label: 'Executive' },
  { value: 'MULTI-GENERATION', label: 'Multi-Generation' },
];

const MONTH_OPTIONS = [
  { value: 6, label: 'Past 6 Months' },
  { value: 12, label: 'Past 12 Months (Default)' },
  { value: 18, label: 'Past 18 Months' },
  { value: 24, label: 'Past 24 Months (Max)' },
];

const BUDGET_PRESETS = [400000, 500000, 600000, 750000, 900000];

// Format number with commas
function formatSGD(num: number): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0,
  }).format(num);
}

export default function App() {
  // Input states
  const [budgetString, setBudgetString] = useState<string>('550,000');
  const [flatType, setFlatType] = useState<string>('4 ROOM');
  const [months, setMonths] = useState<number>(12);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Search result states
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingGeocodes, setLoadingGeocodes] = useState<boolean>(false);
  const [searchDone, setSearchDone] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [towns, setTowns] = useState<TownSummary[]>([]);
  const [blocks, setBlocks] = useState<BlockTransaction[]>([]);
  const [searchedBudget, setSearchedBudget] = useState<number>(550000);
  const [selectedTownFilter, setSelectedTownFilter] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockTransaction | null>(null);

  // Active view tab on mobile
  const [activeTab, setActiveTab] = useState<'towns' | 'blocks' | 'map'>('towns');

  // Map references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());

  // Singapore bounds for Leaflet
  const singaporeBounds = useMemo(() => {
    return L.latLngBounds([1.1304753, 103.59], [1.4705583, 104.094523]);
  }, []);

  // Format budget input with thousands separator
  const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.replace(/[^0-9]/g, '');
    if (rawVal === '') {
      setBudgetString('');
      setValidationError('Please enter a budget in SGD');
      return;
    }
    const num = parseInt(rawVal, 10);
    setBudgetString(num.toLocaleString('en-US'));
    if (num <= 0) {
      setValidationError('Budget must be greater than SGD 0');
    } else {
      setValidationError(null);
    }
  };

  const handleSelectPreset = (preset: number) => {
    setBudgetString(preset.toLocaleString('en-US'));
    setValidationError(null);
  };

  // Perform Affordability Search
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const numericBudget = parseInt(budgetString.replace(/[^0-9]/g, ''), 10);
    if (isNaN(numericBudget) || numericBudget <= 0) {
      setValidationError('Please enter a valid positive whole number budget');
      return;
    }

    setValidationError(null);
    setLoading(true);
    setErrorMessage(null);
    setSelectedTownFilter(null);
    setSelectedBlock(null);

    try {
      const params = new URLSearchParams({
        budget: String(numericBudget),
        months: String(months),
      });
      if (flatType) {
        params.append('flat_type', flatType);
      }

      const res = await fetch(`/api/hdb?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Failed to fetch HDB data (HTTP ${res.status})`);
      }

      const data: HdbApiResponse = await res.json();
      setTowns(data.towns || []);
      setSearchedBudget(numericBudget);
      setSearchDone(true);

      const rawBlocks = data.blocks || [];
      setBlocks(rawBlocks);

      // Trigger geocoding for blocks
      if (rawBlocks.length > 0) {
        geocodeBlocks(rawBlocks);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while fetching HDB data');
      setTowns([]);
      setBlocks([]);
      setSearchDone(true);
    } finally {
      setLoading(false);
    }
  };

  // Geocode addresses via api/geocode
  const geocodeBlocks = async (blocksToGeocode: BlockTransaction[]) => {
    setLoadingGeocodes(true);
    try {
      // Extract unique addresses up to 50
      const addresses = blocksToGeocode
        .map((b) => `${b.block} ${b.street_name}`)
        .slice(0, 50);

      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses }),
      });

      if (!response.ok) {
        console.warn('Geocoding request returned non-OK status:', response.status);
        return;
      }

      const geoData = await response.json();
      const resultMap = new Map<string, { lat?: number; lng?: number }>();
      if (Array.isArray(geoData.results)) {
        for (const item of geoData.results) {
          if (item.address && typeof item.lat === 'number' && typeof item.lng === 'number') {
            resultMap.set(item.address.toUpperCase(), { lat: item.lat, lng: item.lng });
          }
        }
      }

      // Attach coordinates to blocks
      setBlocks((prevBlocks) =>
        prevBlocks.map((blk) => {
          const key = `${blk.block} ${blk.street_name}`.toUpperCase();
          const geo = resultMap.get(key);
          if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
            return { ...blk, lat: geo.lat, lng: geo.lng };
          }
          return blk;
        })
      );
    } catch (err) {
      console.warn('Geocoding error:', err);
    } finally {
      setLoadingGeocodes(false);
    }
  };

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Create map
    const map = L.map(mapContainerRef.current, {
      center: [1.3521, 103.8198],
      zoom: 12,
      minZoom: 11,
      maxZoom: 19,
      maxBounds: singaporeBounds,
      maxBoundsViscosity: 1.0,
      zoomControl: true,
      attributionControl: true,
    });

    // OneMap Default basemap tiles
    const oneMapLayer = L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      minZoom: 11,
      maxZoom: 19,
      bounds: singaporeBounds,
      attribution:
        '<a href="https://www.onemap.gov.sg" target="_blank" rel="noopener noreferrer" style="margin-right: 4px; display: inline-flex; align-items: center; vertical-align: middle;"><img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:16px;width:16px;margin-right:4px;" alt="OneMap"/>OneMap</a> &copy; contributors | Singapore Land Authority',
    });

    oneMapLayer.addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersLayerRef.current = markersGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [singaporeBounds]);

  // Filtered blocks based on town selection
  const displayedBlocks = useMemo(() => {
    if (!selectedTownFilter) return blocks;
    return blocks.filter((b) => b.town.toUpperCase() === selectedTownFilter.toUpperCase());
  }, [blocks, selectedTownFilter]);

  // Update map markers when blocks or filter change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();
    markersMapRef.current.clear();

    const validMarkers: L.Marker[] = [];

    displayedBlocks.forEach((blockItem, idx) => {
      if (typeof blockItem.lat === 'number' && typeof blockItem.lng === 'number') {
        const isSelected =
          selectedBlock &&
          selectedBlock.block === blockItem.block &&
          selectedBlock.street_name === blockItem.street_name &&
          selectedBlock.resale_price === blockItem.resale_price;

        const pinHtml = isSelected
          ? `<div style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 36px;
              height: 36px;
              background: #0284c7;
              color: white;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              box-shadow: 0 4px 14px rgba(2, 132, 199, 0.6);
              border: 3px solid white;
            ">
              <span style="transform: rotate(45deg); font-size: 15px; font-weight: bold; line-height: 1;">🏠</span>
            </div>`
          : `<div style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 30px;
              height: 30px;
              background: #0f172a;
              color: white;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              box-shadow: 0 3px 8px rgba(0,0,0,0.3);
              border: 2px solid white;
            ">
              <span style="transform: rotate(45deg); font-size: 13px; font-weight: bold; line-height: 1;">🏢</span>
            </div>`;

        const pinIcon = L.divIcon({
          className: 'custom-hdb-pin',
          html: pinHtml,
          iconSize: isSelected ? [36, 36] : [30, 30],
          iconAnchor: isSelected ? [18, 36] : [15, 30],
          popupAnchor: [0, -32],
        });

        const marker = L.marker([blockItem.lat, blockItem.lng], { icon: pinIcon });

        const popupContent = `
          <div style="font-family: system-ui, sans-serif; min-width: 200px; padding: 4px;">
            <div style="font-size: 11px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">
              ${blockItem.town}
            </div>
            <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
              Blk ${blockItem.block} ${blockItem.street_name}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0;">
              <span style="font-size: 12px; color: #64748b;">Flat Type:</span>
              <span style="font-size: 12px; font-weight: 600; color: #1e293b;">${blockItem.flat_type}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0;">
              <span style="font-size: 12px; color: #64748b;">Resale Price:</span>
              <span style="font-size: 14px; font-weight: 800; color: #059669;">${formatSGD(blockItem.resale_price)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
              <span style="font-size: 11px; color: #64748b;">Month:</span>
              <span style="font-size: 11px; color: #334155;">${blockItem.month}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <span style="font-size: 11px; color: #64748b;">Floor / Lease:</span>
              <span style="font-size: 11px; color: #334155;">${blockItem.storey_range} (${blockItem.floor_area_sqm} sqm)</span>
            </div>
          </div>
        `;

        marker.bindPopup(popupContent, { maxWidth: 280 });
        marker.addTo(markersGroup);

        const key = `${blockItem.block}_${blockItem.street_name}_${idx}`;
        markersMapRef.current.set(key, marker);
        validMarkers.push(marker);

        marker.on('click', () => {
          setSelectedBlock(blockItem);
        });
      }
    });

    // Fit map bounds to show all markers
    if (validMarkers.length > 0) {
      const featureGroup = L.featureGroup(validMarkers);
      map.fitBounds(featureGroup.getBounds(), {
        padding: [45, 45],
        maxZoom: 16,
      });
    }
  }, [displayedBlocks, selectedBlock]);

  // When a block is clicked from list, zoom and open popup
  const handleSelectBlockFromList = (blockItem: BlockTransaction) => {
    setSelectedBlock(blockItem);
    const map = mapInstanceRef.current;
    if (map && typeof blockItem.lat === 'number' && typeof blockItem.lng === 'number') {
      map.setView([blockItem.lat, blockItem.lng], 16, { animate: true });
      // Find marker and open popup
      for (const [_, marker] of markersMapRef.current.entries()) {
        const latLng = marker.getLatLng();
        if (
          Math.abs(latLng.lat - blockItem.lat) < 0.0001 &&
          Math.abs(latLng.lng - blockItem.lng) < 0.0001
        ) {
          marker.openPopup();
          break;
        }
      }
    }
  };

  // Initial load search
  useEffect(() => {
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute stats
  const withinBudgetTowns = useMemo(() => towns.filter((t) => t.within_budget), [towns]);
  const lowestMedianTown = useMemo(() => (towns.length > 0 ? towns[0] : null), [towns]);
  const lowestOverallPrice = useMemo(() => {
    if (towns.length === 0) return null;
    let min = Infinity;
    for (const t of towns) {
      if (t.lowest < min) min = t.lowest;
    }
    return min === Infinity ? null : min;
  }, [towns]);

  // Formatted date for footer
  const formattedDate = useMemo(() => {
    const now = new Date();
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">
                HDB Resale Affordability Search
              </h1>
              <p className="text-xs text-slate-500 font-medium hidden sm:block">
                Singapore Resale Flat Affordability &amp; Median Analysis
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/health"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              title="Inspect upstream API connectivity"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              API Health
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Search Filter Box */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-slate-200">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              {/* Budget Input */}
              <div className="md:col-span-5 space-y-1.5">
                <label htmlFor="budget-input" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Target Budget (SGD) <span className="text-rose-500">*</span>
                </label>
                <div className="relative rounded-xl shadow-xs">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-semibold">
                    SGD $
                  </div>
                  <input
                    id="budget-input"
                    type="text"
                    inputMode="numeric"
                    value={budgetString}
                    onChange={handleBudgetChange}
                    placeholder="e.g. 550,000"
                    className={`block w-full rounded-xl border pl-18 pr-4 py-2.5 text-slate-900 font-medium text-base focus:outline-none focus:ring-2 transition ${
                      validationError
                        ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-200'
                        : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                    }`}
                  />
                </div>
                {validationError && (
                  <p className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {validationError}
                  </p>
                )}
              </div>

              {/* Flat Type Dropdown */}
              <div className="md:col-span-3 space-y-1.5">
                <label htmlFor="flattype-select" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Flat Type
                </label>
                <select
                  id="flattype-select"
                  value={flatType}
                  onChange={(e) => setFlatType(e.target.value)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 font-medium text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                >
                  {FLAT_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {ft.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Period Selector */}
              <div className="md:col-span-2 space-y-1.5">
                <label htmlFor="months-select" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Time Period
                </label>
                <select
                  id="months-select"
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 font-medium text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                >
                  {MONTH_OPTIONS.map((mo) => (
                    <option key={mo.value} value={mo.value}>
                      {mo.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Button */}
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={loading || Boolean(validationError)}
                  className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Search
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Budget Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500 font-medium">Quick Presets:</span>
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                >
                  {formatSGD(preset)}
                </button>
              ))}
            </div>
          </form>
        </div>

        {/* Error message banner */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-bold">Search Error</h4>
              <p className="text-xs mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* No within-budget transactions found notice */}
        {searchDone && !loading && blocks.length === 0 && (
          <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 shadow-xs">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Info className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-amber-900">
                  No resale flat transactions found within {formatSGD(searchedBudget)}
                </h3>
                <p className="text-sm text-amber-800 leading-relaxed">
                  No transactions were registered at or under {formatSGD(searchedBudget)}{' '}
                  {flatType ? `for ${flatType} flats` : 'across all flat types'} in the requested period.
                  {lowestMedianTown && (
                    <span className="font-semibold block mt-1">
                      We suggest considering <span className="underline decoration-amber-500">{lowestMedianTown.town}</span>, which has the lowest median resale price at{' '}
                      <span className="text-amber-950 font-bold">{formatSGD(lowestMedianTown.median)}</span>.
                    </span>
                  )}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (lowestMedianTown) {
                        handleSelectPreset(lowestMedianTown.median);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-200 hover:bg-amber-300 text-amber-900 transition cursor-pointer"
                  >
                    Adjust Budget to {lowestMedianTown ? formatSGD(lowestMedianTown.median) : 'Lowest Town'}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Overview Metrics */}
        {searchDone && !loading && towns.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Within Budget Towns
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">{withinBudgetTowns.length}</span>
                <span className="text-xs text-slate-500">of {towns.length} towns</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {withinBudgetTowns.length > 0
                  ? 'Town medians at or under budget'
                  : 'No town medians within budget'}
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Blocks At / Under Budget
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-blue-600">{blocks.length}</span>
                <span className="text-xs text-slate-500">recent transactions</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {loadingGeocodes ? 'Geocoding OneMap coords...' : 'Mapped on Singapore tiles'}
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Lowest Price In Period
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-600">
                  {lowestOverallPrice ? formatSGD(lowestOverallPrice) : 'N/A'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">Across all Singapore towns</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Lowest Median Town
              </div>
              <div className="mt-1 flex items-baseline gap-2 truncate">
                <span className="text-lg font-black text-slate-900 truncate">
                  {lowestMedianTown ? lowestMedianTown.town : 'N/A'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 font-semibold text-emerald-700">
                {lowestMedianTown ? `Median: ${formatSGD(lowestMedianTown.median)}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Mobile View Switcher */}
        {searchDone && !loading && (
          <div className="lg:hidden flex rounded-xl bg-slate-200 p-1">
            <button
              onClick={() => setActiveTab('towns')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                activeTab === 'towns'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Towns ({towns.length})
            </button>
            <button
              onClick={() => setActiveTab('blocks')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                activeTab === 'blocks'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Blocks ({displayedBlocks.length})
            </button>
            <button
              onClick={() => setActiveTab('map')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                activeTab === 'map'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              OneMap ({blocks.filter((b) => b.lat).length})
            </button>
          </div>
        )}

        {/* Main Grid: Left Column (Towns & Block List) + Right Column (Interactive OneMap) */}
        {searchDone && !loading && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column */}
            <div
              className={`lg:col-span-6 space-y-6 ${
                activeTab === 'map' ? 'hidden lg:block' : 'block'
              }`}
            >
              {/* Section 1: Town Summary Table */}
              <div
                className={`bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden ${
                  activeTab === 'blocks' ? 'hidden lg:block' : 'block'
                }`}
              >
                <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-blue-600" />
                      HDB Town Summary
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Sorted by median price ascending. Towns within budget are highlighted in green.
                    </p>
                  </div>
                  {selectedTownFilter && (
                    <button
                      onClick={() => setSelectedTownFilter(null)}
                      className="text-xs px-2.5 py-1 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold transition cursor-pointer"
                    >
                      Clear filter ({selectedTownFilter}) ✕
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-slate-700 text-xs uppercase font-bold sticky top-0 z-10">
                      <tr>
                        <th className="py-3 px-4">Town</th>
                        <th className="py-3 px-4">Median Price</th>
                        <th className="py-3 px-4">Lowest Price</th>
                        <th className="py-3 px-4 text-center">Txns</th>
                        <th className="py-3 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {towns.map((t) => {
                        const isFiltered = selectedTownFilter?.toUpperCase() === t.town.toUpperCase();
                        return (
                          <tr
                            key={t.town}
                            onClick={() =>
                              setSelectedTownFilter(isFiltered ? null : t.town)
                            }
                            className={`cursor-pointer transition hover:bg-slate-100/70 ${
                              isFiltered
                                ? 'bg-blue-50/80 ring-2 ring-blue-500 ring-inset'
                                : t.within_budget
                                ? 'bg-emerald-50/40'
                                : ''
                            }`}
                          >
                            <td className="py-3 px-4 font-bold text-slate-900">
                              <div className="flex items-center gap-1.5">
                                <span>{t.town}</span>
                                {isFiltered && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-800">
                              {formatSGD(t.median)}
                            </td>
                            <td className="py-3 px-4 text-slate-600 text-xs">
                              {formatSGD(t.lowest)}
                            </td>
                            <td className="py-3 px-4 text-center text-xs text-slate-500">
                              {t.count}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {t.within_budget ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Within Budget
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                                  Over Budget
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 2: Block List (Up to 50 transactions at or under budget) */}
              <div
                className={`bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden ${
                  activeTab === 'towns' ? 'hidden lg:block' : 'block'
                }`}
              >
                <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <List className="w-5 h-5 text-blue-600" />
                      Recent Transactions At or Under Budget
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Showing {displayedBlocks.length} transaction{displayedBlocks.length === 1 ? '' : 's'}{' '}
                      (most recent first)
                      {selectedTownFilter && ` in ${selectedTownFilter}`}
                    </p>
                  </div>
                  {loadingGeocodes && (
                    <span className="text-xs font-medium text-blue-600 flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                      <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      Geocoding...
                    </span>
                  )}
                </div>

                <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                  {displayedBlocks.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">
                      No block transactions match this filter.
                    </div>
                  ) : (
                    displayedBlocks.map((blk, idx) => {
                      const isSelected =
                        selectedBlock &&
                        selectedBlock.block === blk.block &&
                        selectedBlock.street_name === blk.street_name &&
                        selectedBlock.resale_price === blk.resale_price;

                      return (
                        <div
                          key={`${blk.block}-${blk.street_name}-${idx}`}
                          onClick={() => handleSelectBlockFromList(blk)}
                          className={`p-4 hover:bg-slate-50 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isSelected ? 'bg-blue-50/80 border-l-4 border-blue-600' : ''
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-slate-900">
                                Blk {blk.block} {blk.street_name}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                                {blk.town}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-bold">
                                {blk.flat_type}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                              <span>Storey: {blk.storey_range}</span>
                              <span>•</span>
                              <span>Area: {blk.floor_area_sqm} sqm</span>
                              <span>•</span>
                              <span>Lease: {blk.remaining_lease}</span>
                            </div>
                          </div>

                          <div className="text-left sm:text-right shrink-0">
                            <div className="text-base font-extrabold text-emerald-700">
                              {formatSGD(blk.resale_price)}
                            </div>
                            <div className="text-xs text-slate-500 font-medium">
                              Month: {blk.month}
                            </div>
                            {blk.lat ? (
                              <div className="text-[11px] text-blue-600 font-semibold mt-0.5 flex items-center sm:justify-end gap-1">
                                <MapPin className="w-3 h-3" />
                                Mapped on OneMap
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                Coordinates unlisted
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: OneMap Map Container */}
            <div
              className={`lg:col-span-6 space-y-4 ${
                activeTab === 'towns' || activeTab === 'blocks'
                  ? 'hidden lg:block'
                  : 'block'
              }`}
            >
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col h-[600px] lg:h-[750px] sticky top-20">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 shrink-0">
                  <div className="flex items-center gap-2">
                    <MapIcon className="w-5 h-5 text-blue-600" />
                    <h2 className="text-base font-bold text-slate-900">
                      OneMap Singapore View
                    </h2>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    {displayedBlocks.filter((b) => b.lat).length} of {displayedBlocks.length} geocoded
                  </span>
                </div>

                {/* Leaflet Map Div */}
                <div className="flex-1 w-full relative">
                  <div
                    ref={mapContainerRef}
                    className="w-full h-full z-10"
                    style={{ minHeight: '400px' }}
                  />

                  {loadingGeocodes && (
                    <div className="absolute top-3 right-3 z-20 bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-lg shadow-md border border-slate-200 flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      Geocoding addresses...
                    </div>
                  )}

                  {selectedBlock && (
                    <div className="absolute bottom-4 left-4 right-4 z-20 bg-white/95 backdrop-blur-sm p-3.5 rounded-xl shadow-lg border border-slate-200 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-blue-600 uppercase">
                          Selected Block
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          Blk {selectedBlock.block} {selectedBlock.street_name} ({selectedBlock.town})
                        </div>
                        <div className="text-xs text-slate-600">
                          {selectedBlock.flat_type} • {selectedBlock.floor_area_sqm} sqm • Month: {selectedBlock.month}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-black text-emerald-700">
                          {formatSGD(selectedBlock.resale_price)}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedBlock(null)}
                          className="text-[11px] text-slate-500 hover:text-slate-800 underline mt-0.5 cursor-pointer"
                        >
                          Deselect
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mandatory Footer with exact attribution and open data licence link */}
      <footer className="bg-white border-t border-slate-200 mt-12 py-8 text-slate-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4 text-xs leading-relaxed">
          <p>
            Contains information from Resale flat prices based on registration date from Jan-2017
            onwards accessed on {formattedDate} from the Housing &amp; Development Board, which is
            made available under the terms of the Singapore Open Data Licence version 1.0{' '}
            <a
              href="https://data.gov.sg/open-data-licence"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-semibold inline-flex items-center gap-0.5"
            >
              https://data.gov.sg/open-data-licence
              <ExternalLink className="w-3 h-3" />
            </a>
            . Map data &copy; OneMap, Singapore Land Authority. Prices shown are past transactions,
            not current listings or valuations. This is an SMU course project and is not affiliated
            with or endorsed by HDB, SLA or GovTech.
          </p>
        </div>
      </footer>
    </div>
  );
}
