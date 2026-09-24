import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Server,
  Database,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ArrowLeft,
  ExternalLink,
  Zap,
  Globe,
  Terminal,
  Cpu,
  Layers,
  ChevronRight,
} from 'lucide-react';

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  total_latency_ms?: number;
  credentials: {
    data_gov_sg_api_key_configured: boolean;
    onemap_email_configured: boolean;
    onemap_password_configured: boolean;
  };
  upstream: {
    data_gov_sg: {
      status: number | null;
      ok: boolean;
      latency_ms?: number | null;
    };
    onemap: {
      status: number | null;
      ok: boolean;
      latency_ms?: number | null;
    };
  };
}

export interface PingLogEntry {
  id: string;
  timestamp: string;
  status: 'healthy' | 'degraded';
  totalLatency: number;
  dataGovOk: boolean;
  dataGovLatency?: number | null;
  oneMapOk: boolean;
  oneMapLatency?: number | null;
}

interface ApiHealthDashboardProps {
  onBackToSearch: () => void;
}

type TestEndpoint = '/api/health' | '/api/hdb' | '/api/geocode';

export const ApiHealthDashboard: React.FC<ApiHealthDashboardProps> = ({ onBackToSearch }) => {
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [pingHistory, setPingHistory] = useState<PingLogEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeAgo, setTimeAgo] = useState<string>('just now');

  // Interactive Endpoint Tester State
  const [selectedEndpoint, setSelectedEndpoint] = useState<TestEndpoint>('/api/health');
  const [testEndpointParam, setTestEndpointParam] = useState<string>('');
  const [testLoading, setTestLoading] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    latencyMs: number;
    data: unknown;
    timestamp: string;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch health data
  const fetchHealth = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    const startMs = Date.now();
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const clientLatency = Date.now() - startMs;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const json: HealthResponse = await res.json();
      setHealthData(json);
      setError(null);
      const now = new Date();
      setLastUpdated(now);

      // Append to rolling ping history (keep last 12)
      const newEntry: PingLogEntry = {
        id: `${now.getTime()}`,
        timestamp: now.toLocaleTimeString(),
        status: json.status,
        totalLatency: json.total_latency_ms || clientLatency,
        dataGovOk: json.upstream?.data_gov_sg?.ok ?? false,
        dataGovLatency: json.upstream?.data_gov_sg?.latency_ms,
        oneMapOk: json.upstream?.onemap?.ok ?? false,
        oneMapLatency: json.upstream?.onemap?.latency_ms,
      };

      setPingHistory((prev) => [newEntry, ...prev.slice(0, 11)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach health endpoint');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    fetchHealth(true);
  }, [fetchHealth]);

  // Handle auto-refresh interval (every 15 seconds)
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        fetchHealth(false);
      }, 15000);
    } else if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }
    };
  }, [autoRefresh, fetchHealth]);

  // Update relative time counter every 2 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (!lastUpdated) {
        setTimeAgo('never');
        return;
      }
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (seconds < 5) {
        setTimeAgo('just now');
      } else if (seconds < 60) {
        setTimeAgo(`${seconds}s ago`);
      } else {
        const mins = Math.floor(seconds / 60);
        setTimeAgo(`${mins}m ago`);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [lastUpdated]);

  // Run live endpoint test
  const handleRunTest = async (endpoint: TestEndpoint, customParam?: string) => {
    setTestLoading(true);
    setTestError(null);
    setTestResult(null);

    let url: string = endpoint;
    const param = customParam !== undefined ? customParam : testEndpointParam;

    if (endpoint === '/api/hdb') {
      url = param ? `/api/hdb?${param}` : '/api/hdb?budget=550000&tolerance_pct=0&range_mode=band&months=3';
    } else if (endpoint === '/api/geocode') {
      url = param ? `/api/geocode?address=${encodeURIComponent(param)}` : '/api/geocode?address=101+Towner+Road';
    }

    const start = Date.now();
    try {
      const res = await fetch(url);
      const latencyMs = Date.now() - start;
      const data = await res.json().catch(() => null);

      setTestResult({
        status: res.status,
        latencyMs,
        data,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setTestLoading(false);
    }
  };

  const isAllHealthy = healthData?.status === 'healthy';

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans pb-16">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackToSearch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Search</span>
            </button>
            <div className="h-4 w-px bg-slate-200 hidden sm:block"></div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-tight flex items-center gap-2">
                  API &amp; System Health Dashboard
                  {healthData && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1 ${
                        isAllHealthy
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isAllHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                        }`}
                      ></span>
                      {isAllHealthy ? 'OPERATIONAL' : 'DEGRADED'}
                    </span>
                  )}
                </h1>
                <p className="text-xs text-slate-500 hidden sm:block">
                  Live monitoring of upstream Government Datastores &amp; OneMap SG API
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              <span>Updated: {timeAgo}</span>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer select-none bg-slate-100 px-2.5 py-1.5 rounded-xl border border-slate-200">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="hidden sm:inline">Auto-refresh (15s)</span>
              <span className="sm:hidden">Auto (15s)</span>
            </label>

            <button
              onClick={() => fetchHealth(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Now</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Error Banner if Health Request Failed */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 shadow-xs">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-bold">Health Check Failed</h4>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Executive Overall Status Banner */}
        <div
          className={`rounded-2xl p-6 border shadow-xs transition ${
            isAllHealthy
              ? 'bg-linear-to-r from-emerald-900 to-slate-900 text-white border-emerald-800'
              : 'bg-linear-to-r from-amber-900 to-slate-900 text-white border-amber-800'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${
                  isAllHealthy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                {isAllHealthy ? <CheckCircle2 className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      isAllHealthy ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
                    }`}
                  ></span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    System Operational Status
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black mt-1">
                  {isAllHealthy
                    ? 'All Singapore Upstream APIs Are 100% Operational'
                    : 'Degraded Connectivity on One or More Upstream Services'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
                  {isAllHealthy
                    ? 'Data.gov.sg HDB Resale transactions datastore and Singapore Land Authority OneMap geocoding services are online with healthy response latency.'
                    : 'One or more upstream external services did not return HTTP 200 OK. Fallback heuristics and cached responses are activated.'}
                </p>
              </div>
            </div>

            <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 border-white/10 pt-3 sm:pt-0 shrink-0">
              <div className="text-xs text-slate-400">Total Latency</div>
              <div className="text-2xl font-black text-white">
                {healthData?.total_latency_ms !== undefined ? `${healthData.total_latency_ms} ms` : '—'}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Timestamp: {healthData?.timestamp ? new Date(healthData.timestamp).toLocaleTimeString() : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* 4 Metric Telemetry Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Overall Status */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                System Status
              </span>
              <div
                className={`p-2 rounded-xl ${
                  isAllHealthy ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                }`}
              >
                <Cpu className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-black text-slate-900">
                {healthData?.status ? healthData.status.toUpperCase() : 'CHECKING...'}
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isAllHealthy ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                ></span>
                {isAllHealthy ? '2 of 2 Upstream Services Online' : 'Partial Outage Detected'}
              </p>
            </div>
          </div>

          {/* Card 2: data.gov.sg */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                data.gov.sg Datastore
              </span>
              <div
                className={`p-2 rounded-xl ${
                  healthData?.upstream?.data_gov_sg?.ok
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-rose-50 text-rose-600'
                }`}
              >
                <Database className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">
                  HTTP {healthData?.upstream?.data_gov_sg?.status || '—'}
                </span>
                <span className="text-xs font-bold text-emerald-600">
                  {healthData?.upstream?.data_gov_sg?.ok ? 'OK' : 'ERR'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-500" />
                Response time:{' '}
                <strong className="text-slate-700">
                  {healthData?.upstream?.data_gov_sg?.latency_ms !== undefined &&
                  healthData.upstream.data_gov_sg.latency_ms !== null
                    ? `${healthData.upstream.data_gov_sg.latency_ms} ms`
                    : '—'}
                </strong>
              </p>
            </div>
          </div>

          {/* Card 3: OneMap Singapore */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                OneMap Singapore API
              </span>
              <div
                className={`p-2 rounded-xl ${
                  healthData?.upstream?.onemap?.ok
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-rose-50 text-rose-600'
                }`}
              >
                <MapPin className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">
                  HTTP {healthData?.upstream?.onemap?.status || '—'}
                </span>
                <span className="text-xs font-bold text-emerald-600">
                  {healthData?.upstream?.onemap?.ok ? 'OK' : 'ERR'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-500" />
                Response time:{' '}
                <strong className="text-slate-700">
                  {healthData?.upstream?.onemap?.latency_ms !== undefined &&
                  healthData.upstream.onemap.latency_ms !== null
                    ? `${healthData.upstream.onemap.latency_ms} ms`
                    : '—'}
                </strong>
              </p>
            </div>
          </div>

          {/* Card 4: Credentials Audit */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Security &amp; Auth
              </span>
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-black text-slate-900">Protected</div>
              <p className="text-xs text-slate-500 mt-1">
                Zero client credential exposure; all proxies server-side.
              </p>
            </div>
          </div>
        </div>

        {/* Detailed Service Deep-Dive Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Service 1: data.gov.sg Detail Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center font-black text-xs">
                  SG
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    data.gov.sg (HDB Resale Flat Prices)
                  </h3>
                  <p className="text-xs text-slate-500">Singapore Government Open Data Datastore API</p>
                </div>
              </div>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${
                  healthData?.upstream?.data_gov_sg?.ok
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {healthData?.upstream?.data_gov_sg?.ok ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Available
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    Unavailable
                  </>
                )}
              </span>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-semibold uppercase text-[10px]">Resource ID</div>
                  <div className="font-mono font-bold text-slate-800 truncate mt-0.5" title="d_8b84c4ee58e3cfc0ece0d773c8ca6abc">
                    d_8b84c4ee58e3cfc0ece0d773c8ca6abc
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-semibold uppercase text-[10px]">HTTP Status</div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {healthData?.upstream?.data_gov_sg?.status === 200
                      ? '200 OK (Healthy)'
                      : `HTTP ${healthData?.upstream?.data_gov_sg?.status || 'Down'}`}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Upstream Endpoint:</span>
                  <a
                    href="https://data.gov.sg/api/action/datastore_search?resource_id=d_8b84c4ee58e3cfc0ece0d773c8ca6abc&limit=1"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-600 hover:underline flex items-center gap-1"
                  >
                    api/action/datastore_search <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between text-slate-600">
                  <span>API Key Configured:</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                      healthData?.credentials?.data_gov_sg_api_key_configured
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {healthData?.credentials?.data_gov_sg_api_key_configured
                      ? 'Custom API Key (x-api-key)'
                      : 'Public Open Tier (Fallback)'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-600">
                  <span>Server-side Caching:</span>
                  <span className="font-semibold text-slate-700">s-maxage=3600 (1 Hour CDN Cache)</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEndpoint('/api/hdb');
                    setTestEndpointParam('budget=550000&tolerance_pct=0&range_mode=band&months=3');
                    handleRunTest('/api/hdb', 'budget=550000&tolerance_pct=0&range_mode=band&months=3');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold transition cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-blue-600" />
                  Test HDB Query (/api/hdb)
                </button>
                <span className="text-slate-400 text-[11px]">Returns 50 filtered resale blocks</span>
              </div>
            </div>
          </div>

          {/* Service 2: OneMap Singapore Detail Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs">
                  SLA
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    OneMap Singapore (Geocoding &amp; Tiles)
                  </h3>
                  <p className="text-xs text-slate-500">Singapore Land Authority Official Spatial Service</p>
                </div>
              </div>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${
                  healthData?.upstream?.onemap?.ok
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {healthData?.upstream?.onemap?.ok ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Available
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    Unavailable
                  </>
                )}
              </span>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-semibold uppercase text-[10px]">Tile Layer</div>
                  <div className="font-mono font-bold text-slate-800 truncate mt-0.5" title="OneMap Default 3857">
                    Default Raster (v3)
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-500 font-semibold uppercase text-[10px]">HTTP Status</div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {healthData?.upstream?.onemap?.status === 200
                      ? '200 OK (Healthy)'
                      : `HTTP ${healthData?.upstream?.onemap?.status || 'Down'}`}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Geocoding Endpoint:</span>
                  <a
                    href="https://www.onemap.gov.sg/api/common/elastic/search?searchVal=Singapore&returnGeom=Y&getAddrDetails=Y&pageNum=1"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-600 hover:underline flex items-center gap-1"
                  >
                    api/common/elastic/search <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between text-slate-600">
                  <span>Authentication State:</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                      healthData?.credentials?.onemap_email_configured
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {healthData?.credentials?.onemap_email_configured
                      ? 'Custom SLA Account'
                      : 'Public Anonymous Access'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-600">
                  <span>Spatial Coordinate System:</span>
                  <span className="font-semibold text-slate-700">WGS84 Lat/Lng &amp; SVY21 Projection</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEndpoint('/api/geocode');
                    setTestEndpointParam('101 Towner Road');
                    handleRunTest('/api/geocode', '101 Towner Road');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold transition cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-blue-600" />
                  Test Geocode (/api/geocode)
                </button>
                <span className="text-slate-400 text-[11px]">Resolves postal coords via SLA</span>
              </div>
            </div>
          </div>
        </div>

        {/* Security & Credentials Audit Box */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">
                Credentials &amp; Environment Audit
              </h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">Read-only Configuration Check</span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            This dashboard validates upstream credentials server-side. For security, sensitive token strings and private keys are strictly kept server-side in environment variables and are never transmitted to client JavaScript.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-y border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Variable Name</th>
                  <th className="py-2.5 px-3">Service</th>
                  <th className="py-2.5 px-3">Configuration Status</th>
                  <th className="py-2.5 px-3">Operational Fallback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-3 px-3 font-mono font-bold text-slate-900">DATA_GOV_SG_API_KEY</td>
                  <td className="py-3 px-3 text-slate-700">data.gov.sg</td>
                  <td className="py-3 px-3">
                    {healthData?.credentials?.data_gov_sg_api_key_configured ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" /> Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600">
                        Not Set (Optional)
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-500">
                    Public search API allows unauthenticated access with standard GovTech rate limits.
                  </td>
                </tr>

                <tr>
                  <td className="py-3 px-3 font-mono font-bold text-slate-900">ONEMAP_EMAIL</td>
                  <td className="py-3 px-3 text-slate-700">OneMap Singapore</td>
                  <td className="py-3 px-3">
                    {healthData?.credentials?.onemap_email_configured ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" /> Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600">
                        Not Set (Optional)
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-500">
                    SLA OneMap elastic search allows public address lookups without authenticated token.
                  </td>
                </tr>

                <tr>
                  <td className="py-3 px-3 font-mono font-bold text-slate-900">ONEMAP_PASSWORD</td>
                  <td className="py-3 px-3 text-slate-700">OneMap Singapore</td>
                  <td className="py-3 px-3">
                    {healthData?.credentials?.onemap_password_configured ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" /> Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600">
                        Not Set (Optional)
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-500">
                    Optional password parameter for refreshing enterprise OneMap session tokens.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Endpoint Playground / Testing Console */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Terminal className="w-5 h-5 text-blue-600" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Interactive Endpoint Tester</h3>
                <p className="text-xs text-slate-500">Trigger live API requests and observe latency and JSON payloads</p>
              </div>
            </div>

            <div className="flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedEndpoint('/api/health');
                  setTestEndpointParam('');
                }}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  selectedEndpoint === '/api/health' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                /api/health
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedEndpoint('/api/hdb');
                  setTestEndpointParam('budget=550000&tolerance_pct=0&range_mode=band&months=3');
                }}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  selectedEndpoint === '/api/hdb' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                /api/hdb
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedEndpoint('/api/geocode');
                  setTestEndpointParam('101 Towner Road');
                }}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  selectedEndpoint === '/api/geocode' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                /api/geocode
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-center">
            <div className="flex-1 w-full relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 font-mono text-xs">
                GET {selectedEndpoint}
                {selectedEndpoint === '/api/geocode' ? '?address=' : selectedEndpoint === '/api/hdb' ? '?' : ''}
              </div>
              <input
                type="text"
                value={testEndpointParam}
                onChange={(e) => setTestEndpointParam(e.target.value)}
                placeholder={
                  selectedEndpoint === '/api/health'
                    ? '(No parameters needed)'
                    : selectedEndpoint === '/api/hdb'
                    ? 'budget=550000&tolerance_pct=0&range_mode=band&months=3'
                    : '101 Towner Road'
                }
                disabled={selectedEndpoint === '/api/health'}
                className="w-full rounded-xl border border-slate-300 pl-36 pr-4 py-2.5 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 transition"
              />
            </div>
            <button
              type="button"
              onClick={() => handleRunTest(selectedEndpoint)}
              disabled={testLoading}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {testLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Testing...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Execute Request
                </>
              )}
            </button>
          </div>

          {/* Test Error */}
          {testError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              <strong>Error:</strong> {testError}
            </div>
          )}

          {/* Test Result View */}
          {testResult && (
            <div className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 overflow-hidden shadow-xs">
              <div className="px-4 py-2 bg-slate-800 flex items-center justify-between border-b border-slate-700 text-xs font-mono">
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400 font-bold">HTTP {testResult.status}</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-amber-400 font-semibold">{testResult.latencyMs} ms</span>
                </div>
                <span className="text-slate-400 text-[11px]">{testResult.timestamp}</span>
              </div>
              <div className="p-4 max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300">
                <pre>{JSON.stringify(testResult.data, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Live Ping History & Latency Trend */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Layers className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-bold text-slate-900">Health Polling Activity Log</h3>
                <p className="text-xs text-slate-500">Recent automated and manual diagnostic polls</p>
              </div>
            </div>
            <span className="text-xs text-slate-500 font-medium">Last {pingHistory.length} Checks</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-y border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">System Status</th>
                  <th className="py-2.5 px-3">Total Latency</th>
                  <th className="py-2.5 px-3">data.gov.sg</th>
                  <th className="py-2.5 px-3">OneMap SG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {pingHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No ping activity recorded yet.
                    </td>
                  </tr>
                ) : (
                  pingHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-2.5 px-3 font-mono text-slate-600">{item.timestamp}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[11px] ${
                            item.status === 'healthy'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              item.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          ></span>
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-800 font-bold">
                        {item.totalLatency} ms
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-semibold ${
                            item.dataGovOk ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          {item.dataGovOk ? '200 OK' : 'Down'}
                          {item.dataGovLatency !== undefined && item.dataGovLatency !== null && (
                            <span className="text-slate-400 font-normal ml-1">
                              ({item.dataGovLatency} ms)
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-semibold ${
                            item.oneMapOk ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          {item.oneMapOk ? '200 OK' : 'Down'}
                          {item.oneMapLatency !== undefined && item.oneMapLatency !== null && (
                            <span className="text-slate-400 font-normal ml-1">
                              ({item.oneMapLatency} ms)
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};
