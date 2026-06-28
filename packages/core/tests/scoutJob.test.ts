import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/toolLayer.js";

describe("ScoutJob — InMemoryStore", () => {
  it("create_scout_job создаёт задачу с пустым списком каналов", async () => {
    const store = new InMemoryStore();
    const res = await store.applyAction({
      type: "create_scout_job",
      payload: {
        tenant_id: "t1",
        search_signals: ["ленточный фундамент", "фундамент под дом"],
        poll_interval_minutes: 30,
      },
    });

    expect(res.applied).toBe(true);
    const jobs = await store.getScoutJobs("t1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].channels).toHaveLength(0);
    expect(jobs[0].status).toBe("paused");
    expect(jobs[0].search_signals).toEqual(["ленточный фундамент", "фундамент под дом"]);
    expect(jobs[0].poll_interval_minutes).toBe(30);
    expect(jobs[0].tenant_id).toBe("t1");
  });

  it("add_scout_channel добавляет каналы разных платформ", async () => {
    const store = new InMemoryStore();
    const createRes = await store.applyAction({
      type: "create_scout_job",
      payload: { tenant_id: "t1", search_signals: [] },
    });
    expect(createRes.applied).toBe(true);
    const jobId = (createRes.action.payload as any).id as string;

    await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "telegram", identifier: "@stroyforumru" },
    });
    await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "vk", identifier: "club_stroitelstvo" },
    });
    await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "telegram", identifier: "@fundament_expert" },
    });

    const jobs = await store.getScoutJobs("t1");
    expect(jobs[0].channels).toHaveLength(3);
    expect(jobs[0].channels.map((c) => c.platform)).toEqual(
      expect.arrayContaining(["telegram", "telegram", "vk"]),
    );
    expect(jobs[0].channels.every((c) => c.added_manually)).toBe(true);
  });

  it("add_scout_channel отклоняет дубль", async () => {
    const store = new InMemoryStore();
    const createRes = await store.applyAction({
      type: "create_scout_job",
      payload: { tenant_id: "t1", search_signals: [] },
    });
    const jobId = (createRes.action.payload as any).id as string;

    await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "vk", identifier: "club1" },
    });
    const dup = await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "vk", identifier: "club1" },
    });
    expect(dup.applied).toBe(false);
    expect(dup.error).toMatch(/already added/);
  });

  it("remove_scout_channel удаляет нужный канал, остальные остаются", async () => {
    const store = new InMemoryStore();
    const createRes = await store.applyAction({
      type: "create_scout_job",
      payload: { tenant_id: "t1", search_signals: [] },
    });
    const jobId = (createRes.action.payload as any).id as string;

    await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "telegram", identifier: "@ch1" },
    });
    await store.applyAction({
      type: "add_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "vk", identifier: "vk_group" },
    });

    const removeRes = await store.applyAction({
      type: "remove_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "telegram", identifier: "@ch1" },
    });
    expect(removeRes.applied).toBe(true);

    const jobs = await store.getScoutJobs("t1");
    expect(jobs[0].channels).toHaveLength(1);
    expect(jobs[0].channels[0].platform).toBe("vk");
  });

  it("remove_scout_channel возвращает ошибку для несуществующего канала", async () => {
    const store = new InMemoryStore();
    const createRes = await store.applyAction({
      type: "create_scout_job",
      payload: { tenant_id: "t1", search_signals: [] },
    });
    const jobId = (createRes.action.payload as any).id as string;

    const res = await store.applyAction({
      type: "remove_scout_channel",
      payload: { tenant_id: "t1", scout_job_id: jobId, platform: "vk", identifier: "nonexistent" },
    });
    expect(res.applied).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it("update_scout_job_status меняет статус", async () => {
    const store = new InMemoryStore();
    const createRes = await store.applyAction({
      type: "create_scout_job",
      payload: { tenant_id: "t1", search_signals: [] },
    });
    const jobId = (createRes.action.payload as any).id as string;

    const startRes = await store.applyAction({
      type: "update_scout_job_status",
      payload: { tenant_id: "t1", scout_job_id: jobId, status: "running" },
    });
    expect(startRes.applied).toBe(true);
    expect((await store.getScoutJobs("t1"))[0].status).toBe("running");

    await store.applyAction({
      type: "update_scout_job_status",
      payload: { tenant_id: "t1", scout_job_id: jobId, status: "stopped" },
    });
    expect((await store.getScoutJobs("t1"))[0].status).toBe("stopped");
  });

  it("ScoutJob одного тенанта не виден другому", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "create_scout_job",
      payload: { tenant_id: "tenant_A", search_signals: [] },
    });

    expect(await store.getScoutJobs("tenant_A")).toHaveLength(1);
    expect(await store.getScoutJobs("tenant_B")).toHaveLength(0);
  });

  it("update_scout_job_status на несуществующую задачу возвращает ошибку", async () => {
    const store = new InMemoryStore();
    const res = await store.applyAction({
      type: "update_scout_job_status",
      payload: { tenant_id: "t1", scout_job_id: "no-such-id", status: "running" },
    });
    expect(res.applied).toBe(false);
    expect(res.error).toMatch(/not found/);
  });
});
