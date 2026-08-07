import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import PipelinePage             from './pages/PipelinePage'
import { ProjectsPage, CompletedProjectsPage } from './pages/ProjectsPage'
import BudgetPage               from './pages/BudgetPage'
import ResourcesPage            from './pages/ResourcesPage'
import { IntegrationsPage }     from './pages/IntegrationsPage'
import { PermissionsPage }      from './pages/PermissionsPage'
import { AcceptInvitePage }     from './pages/AcceptInvitePage'

function CompletedPage() {
  return <CompletedProjectsPage/>
}

function MainApp() {
  return (
    <Layout>
      <Routes>
        <Route path="/"                  element={<Navigate to="/upcoming-projects" replace/>}/>
        <Route path="/upcoming-projects" element={<PipelinePage/>}/>
        <Route path="/projects"          element={<ProjectsPage/>}/>
        <Route path="/completed"         element={<CompletedPage/>}/>
        <Route path="/resources"         element={<ResourcesPage/>}/>
        <Route path="/budget"            element={<BudgetPage/>}/>
        <Route path="/integrations"      element={<IntegrationsPage/>}/>
        <Route path="/permissions"       element={<PermissionsPage/>}/>
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Standalone — no sidebar, since whoever's here has no identity yet */}
      <Route path="/accept-invite/:token" element={<AcceptInvitePage/>}/>
      <Route path="/*" element={<MainApp/>}/>
    </Routes>
  )
}
