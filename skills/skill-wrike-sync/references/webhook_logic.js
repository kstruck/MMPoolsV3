/**
 * Wrike Webhook Handler (Cloud Function Template)
 * Place this logic in your Firebase Function  index.js
 */

exports.wrikeWebhook = onRequest(async (req, res) => {
  const events = req.body;
  
  // 1. Verify Wrike Secret (XOO HMAC) - TODO for Production

  for (const event of events) {
    console.log("Received Wrike Event:", event.eventType);

    // 2. Handle Task Completion
    if (event.eventType === "TaskStatusChanged" && event.status === "Completed") {
      const wrikeTaskId = event.taskId;
      
      // 3. Update Firestore Doc
      // Query firestore where 'externalIds.wrike' == wrikeTaskId
      // Update status to 'done'
      console.log(`Marking local task for Wrike ID
${wrikeTaskId} as complete`);
    }
  }

  res.status(200).send("OK");
});
