import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from './PageHeader';

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted">This screen is implemented in a later stage.</CardContent>
      </Card>
    </>
  );
}
