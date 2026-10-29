import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { Card, EmptyState } from '../components/ui/misc'

export function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="That page doesn't exist."
        action={
          <Link to="/" className="text-sm font-medium text-primary-ink hover:underline">
            Go to the dashboard
          </Link>
        }
      />
    </Card>
  )
}
