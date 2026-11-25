import crypto from 'node:crypto';

import * as usersModel from '../models/users.js';
import * as redeemModel from '../models/redeem-keys.js';
import { AppError, errors } from '../util/errors.js';
import { newOrderNo, randomCode } from '../util/ids.js';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_COUNT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function randomKey() {
  const part = () => {
    let out = '';
    for (let index = 0; index < 4; index += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    return out;
  };
  return `P-${part()}-${part()}-${part()}`;
}

export function normalizeRedeemCode(raw) {
  const compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^P[A-Z0-9]{12}$/.test(compact)) {
    return `P-${compact.slice(1, 5)}-${compact.slice(5, 9)}-${compact.slice(9, 13)}`;
  }
  return String(raw || '').trim().toUpperCase();
}

export class RedeemService {
  constructor({ store, logger }) {
    this.store = store;
    this.logger = logger;
  }

  generate({ amountCents, count, note = '', days = 0, createdBy = null }) {
    const amount = Number(amountCents);
    const quantity = Number(count);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) {
      throw errors.validation('充值金额需为不小于 0.01 的有效金额');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_COUNT) {
      throw errors.validation(`一次最多生成 ${MAX_COUNT} 个充值码`);
    }
    const expireDays = Number(days) || 0;
    if (!Number.isInteger(expireDays) || expireDays < 0 || expireDays > 3650) {
      throw errors.validation('有效期天数需为 0–3650 的整数');
    }
    const created = Date.now();
    const expiresAt = expireDays > 0 ? created + expireDays * DAY_MS : null;
    const batch = `B${randomCode(6)}`;
    const text = String(note || '').trim().slice(0, 120);
    const items = [];
    this.store.tx(() => {
      for (let index = 0; index < quantity; index += 1) {
        let id = null;
        let code = '';
        for (let attempt = 0; attempt < 5 && id == null; attempt += 1) {
          code = randomKey();
          try {
            id = redeemModel.create(this.store, {
              code,
              amountCents: amount,
              note: text,
              batch,
              createdBy,
              expiresAt,
            });
          } catch (err) {
            if (!String(err && err.message).includes('UNIQUE')) throw err;
          }
        }
        if (id == null) throw new AppError('redeem_generate_failed', '生成充值码失败，请重试', 500);
        items.push({ id, code, amountCents: amount });
      }
    });
    this.logger?.info(`管理员生成充值码 ${quantity} 个（批次 ${batch}，单个 ${amount} 分）`);
    return { batch, expiresAt, items };
  }

  list({ status = '', batch = '', query = '', page = 1, pageSize = 20 } = {}) {
    const total = redeemModel.count(this.store, { status, batch, query });
    const rows = redeemModel.list(this.store, { status, batch, query, page, pageSize });
    return { items: rows.map(redeemModel.toRedeemKey), total, page, pageSize };
  }

  revoke(id) {
    const row = redeemModel.findById(this.store, id);
    if (!row) throw errors.notFound('redeem_not_found', '充值码不存在');
    if (row.status !== 'unused') throw errors.badRequest('redeem_not_revocable', '只有未使用的充值码可以撤销');
    redeemModel.revoke(this.store, id);
    return { ok: true };
  }

  redeem({ user, code }) {
    const normalized = normalizeRedeemCode(code);
    if (!normalized) throw errors.validation('请输入充值码');
    return this.store.tx(() => {
      const row = redeemModel.findByCode(this.store, normalized);
      if (!row) throw new AppError('redeem_invalid', '充值码无效，请检查后重试', 400);
      if (row.status !== 'unused') throw new AppError('redeem_invalid', '该充值码已被使用或已撤销', 400);
      if (row.expires_at && Number(row.expires_at) <= Date.now()) {
        throw new AppError('redeem_expired', '该充值码已过期', 400);
      }
      if (!redeemModel.markUsed(this.store, row.id, user.id)) {
        throw new AppError('redeem_invalid', '该充值码已被使用', 400);
      }
      const amountCents = Number(row.amount_cents);
      usersModel.addBalance(this.store, user.id, amountCents);
      const orderNo = newOrderNo('R');
      const now = Date.now();
      this.store.run(
        `INSERT INTO orders(order_no, kind, user_id, amount_cents, status, provider, credit_applied, paid_at, created_at, updated_at)
         VALUES (?, 'recharge', ?, ?, 'credited', 'redeem', 1, ?, ?, ?)`,
        orderNo,
        user.id,
        amountCents,
        now,
        now,
        now,
      );
      const fresh = usersModel.findById(this.store, user.id);
      return {
        ok: true,
        amountCents,
        balanceCents: Number(fresh?.balance_cents || 0),
        orderNo,
      };
    });
  }
}
