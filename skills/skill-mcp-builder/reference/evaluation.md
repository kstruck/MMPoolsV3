# MCP Evaluation Standards

## 1. Objective
Generate an XML file containing 10-20 "Question/Answer" pairs to stress-test the MCP server.

## 2. Output Schema
The Agent **MUST** output valid XML using this exact structure:

```xml
<evaluation>
   <qa_pair>
      <question>Find the user 'jdoe' and return their account ID.</question>
      <answer>acct_12345</answer>
   </qa_pair>
   <qa_pair>
      <question>Count the number of active tickets for project 'Apollo'.</question>
      <answer>3</answer>
   </qa_pair>
</evaluation>