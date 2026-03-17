async function test() {
    const res = await fetch('https://wxrvrtcqbigkaimgjgxq.supabase.co/functions/v1/vibedb-ai', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sb_publishable_VdGVHOihHj6cJbsdi_vUvA_clSQFk0I'
        },
        body: JSON.stringify({
            type: 'generate-schema',
            prompt: `Analyze the following requirement and extract the core entities, their ideal relationships, and a robust list of attributes.
Return a strictly valid JSON object of the database schema intent. Output format:
{
  "entities": [
    {
      "name": "users",
      "attributes": [
        { "name": "email", "type": "text" },
        { "name": "is_active", "type": "boolean" },
        { "name": "role", "type": "text" }
      ]
    }
  ],
  "relationships": [
    { "source": "users", "target": "posts", "type": "one_to_many" }
  ]
}
Valid relationship types: one_to_many, many_to_one, many_to_many, one_to_one.
Valid attribute types: text, integer, boolean, timestamp, uuid, jsonb, numeric.

Notes:
1. Do NOT include 'id', 'created_at', or 'updated_at'. They are handled automatically.
2. Generate all the standard fields a production app would need for these tables natively. Think through a high quality schema.
3. Only output JSON.

Requirement: "i want a cryptocurrency algorithm marketplace"`
        })
    });
    if (!res.ok) {
        console.error('ERROR:', res.status, await res.text());
        return;
    }
    const data = await res.json();
    console.log("RAW RESULT ==>");
    console.log(data.result);
}
test();
