import { useState, useEffect } from 'react'
import type { Prospect, Campaign, Stats, ProspectStage } from './types'
import { fetchProspects, fetchCampaigns, fetchStats, runOutreachCycle } from './api'

function App() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [stageFilter, setStageFilter] = useState<string>('')
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0)
  const [locationFilter, setLocationFilter] = useState<string>('')

  useEffect(() => {
    loadData()
  }, [stageFilter, minScoreFilter, locationFilter])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)

      const filters = {
        stage: stageFilter || undefined,
        minScore: minScoreFilter > 0 ? minScoreFilter : undefined,
        location: locationFilter || undefined,
      }

      const [prospectsData, campaignsData, statsData] = await Promise.all([
        fetchProspects(filters),
        fetchCampaigns(),
        fetchStats(),
      ])

      setProspects(prospectsData)
      setCampaigns(campaignsData)
      setStats(statsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  async function handleRunOutreach(campaignId: string) {
    try {
      setRunning(true)
      setError(null)
      await runOutreachCycle(campaignId)
      await loadData()
      alert('Outreach cycle completed successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run outreach cycle')
      alert('Outreach cycle failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setRunning(false)
    }
  }

  function calculateMessageScore(prospect: Prospect): number {
    let score = 0
    const relevance = prospect.score >= 70 ? 3 : prospect.score >= 50 ? 2 : prospect.score >= 30 ? 1 : 0
    score += relevance
    const hasNotes = prospect.notes && prospect.notes.length > 50
    const hasCustomMessage = prospect.messagesSent.some(m => m.content.length > 100)
    const personalization = hasNotes && hasCustomMessage ? 3 : hasNotes || hasCustomMessage ? 2 : 1
    score += personalization
    const ctaClarity = prospect.stage === 'replied' || prospect.stage === 'converted' ? 2 : prospect.messagesSent.length > 0 ? 1 : 0
    score += ctaClarity
    const tone = 2
    score += tone
    return score
  }

  function calculateDaysUntilNextAction(prospect: Prospect): number | null {
    if (!prospect.nextFollowUpAt) return null
    const now = new Date()
    const nextAction = new Date(prospect.nextFollowUpAt)
    const diffMs = nextAction.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    return diffDays
  }

  function getStageColor(stage: ProspectStage): string {
    const colors: Record<ProspectStage, string> = {
      discovered: 'bg-gray-100 text-gray-800',
      connection_sent: 'bg-blue-100 text-blue-800',
      connected: 'bg-green-100 text-green-800',
      first_dm_sent: 'bg-yellow-100 text-yellow-800',
      replied: 'bg-purple-100 text-purple-800',
      converted: 'bg-emerald-100 text-emerald-800',
      opted_out: 'bg-red-100 text-red-800',
    }
    return colors[stage] || 'bg-gray-100 text-gray-800'
  }

  function getStageLabel(stage: ProspectStage): string {
    return stage.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Portal Copy Co</h1>
              <p className="text-sm text-gray-600 mt-1">LinkedIn Outreach Dashboard</p>
            </div>
            {campaigns.length > 0 && (
              <button
                onClick={() => handleRunOutreach(campaigns[0].id)}
                disabled={running}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {running ? 'Running...' : 'Run Outreach Cycle'}
              </button>
            )}
          </div>
        </div>
      </header>

      {stats && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-600">Total Prospects</div>
              <div className="text-3xl font-bold text-gray-900 mt-2">{stats.totalProspects}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-600">Connection Rate</div>
              <div className="text-3xl font-bold text-green-600 mt-2">{(stats.connectionRate * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-600">Reply Rate</div>
              <div className="text-3xl font-bold text-purple-600 mt-2">{(stats.replyRate * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-600">Conversion Rate</div>
              <div className="text-3xl font-bold text-emerald-600 mt-2">{(stats.conversionRate * 100).toFixed(1)}%</div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Stage</label>
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Stages</option>
                <option value="discovered">Discovered</option>
                <option value="connection_sent">Connection Sent</option>
                <option value="connected">Connected</option>
                <option value="first_dm_sent">First DM Sent</option>
                <option value="replied">Replied</option>
                <option value="converted">Converted</option>
                <option value="opted_out">Opted Out</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Score</label>
              <input
                type="number"
                min="0"
                max="100"
                value={minScoreFilter}
                onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
              <input
                type="text"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Florida"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Prospects ({prospects.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Message Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Next Action</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {prospects.map((prospect) => {
                  const messageScore = calculateMessageScore(prospect)
                  const daysUntilNext = calculateDaysUntilNextAction(prospect)
                  return (
                    <tr key={prospect.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{prospect.name}</div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">{prospect.headline}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{prospect.location}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStageColor(prospect.stage)}`}>
                          {getStageLabel(prospect.stage)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900">{prospect.score}</div>
                          <div className="ml-2 w-16 bg-gray-200 rounded-full h-2">
                            <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${prospect.score}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className={`text-sm font-bold ${messageScore >= 7 ? 'text-green-600' : messageScore >= 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {messageScore}/10
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {daysUntilNext !== null ? (
                          <div className="text-sm text-gray-900">
                            {daysUntilNext === 0 ? 'Today' : daysUntilNext === 1 ? 'Tomorrow' : `${daysUntilNext} days`}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-400">-</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <a href={prospect.profileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-900">
                          View Profile
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {prospects.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">No prospects found matching the current filters.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
