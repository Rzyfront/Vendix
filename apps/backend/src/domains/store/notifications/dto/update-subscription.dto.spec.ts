import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSubscriptionDto } from './update-subscription.dto';

async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateSubscriptionDto, body);
  return validate(dto);
}

describe('UpdateSubscriptionDto', () => {
  it.each([
    'new_order',
    'kitchen_ticket_ready',
    'crm_task_assigned',
    'crm_task_due',
    'crm_task_due_soon',
    'crm_task_reassigned',
    'crm_task_closed',
    'crm_task_digest',
  ])('acepta el tipo del catálogo %s', async (type) => {
    expect(await errorsFor({ type, in_app: false, email: true })).toHaveLength(0);
  });

  it.each(['reminder_due', 'workflow_task', 'booking_attending', 'no_existe'])(
    'rechaza %s (fuera del catálogo configurable)',
    async (type) => {
      const errors = await errorsFor({ type, in_app: true });
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('type');
      expect(errors[0].constraints).toHaveProperty('isIn');
    },
  );

  it('rechaza canales que no son booleanos', async () => {
    const errors = await errorsFor({ type: 'crm_task_due', email: 'si' });
    expect(errors.map((e) => e.property)).toEqual(['email']);
  });
});
