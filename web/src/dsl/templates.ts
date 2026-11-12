// Diagram types and starter templates, taken from the examples in docs/research/eraser/02 (section 3).
export type DiagramType = 'flowchart' | 'erd' | 'architecture' | 'sequence' | 'bpmn';

export const DIAGRAM_TYPES: { id: DiagramType; label: string }[] = [
  { id: 'architecture', label: '클라우드 아키텍처' },
  { id: 'flowchart', label: '플로우차트' },
  { id: 'sequence', label: '시퀀스' },
  { id: 'erd', label: 'ERD' },
  { id: 'bpmn', label: 'BPMN' },
];

export const TEMPLATES: Record<DiagramType, string> = {
  architecture: `title Web service
direction right

Users [icon: users]
VPC {
  Public Subnet {
    LB [icon: aws-elb]
    Web [icon: aws-ec2, color: blue]
  }
  Private Subnet {
    DB [icon: aws-rds]
    Queue [icon: aws-sqs]
  }
}

Users > LB: HTTPS
LB > Web
Web > DB: SQL [color: green]
Web > Queue
`,
  flowchart: `title Ticket workflow
direction right

Start [shape: oval, color: green]
Triage [icon: flag]
Valid? [shape: diamond]
Fix [color: blue]
Done [shape: oval]

Start > Triage > Valid?
Valid? > Fix: yes
Valid? > Done: no [color: red]
Fix > Done
`,
  sequence: `title Login
autoNumber on
order Client, API, DB

Client [icon: monitor] > API [icon: server]: POST /login
activate API
API > DB [icon: database]: find user
DB > API: row
alt [label: valid] {
  API > Client: token
}
else [label: invalid] {
  API > Client: 401 [color: red]
}
deactivate API
`,
  erd: `title Billing
notation crows-foot

users [icon: user, color: blue] {
  id string pk
  email string unique not null
  teamId string
}
teams [icon: users] {
  id string pk
  name string
}
products {
  id int pk
  format "enum(DVD, Blu-ray)"
  price decimal(10,2)
}

users.teamId > teams.id: [color: green]
`,
  bpmn: `title Order flow
direction right
layout sequential

Online store {
  Customer {
    Open website [type: activity]
    Place order [type: activity, icon: flag]
  }
  Warehouse {
    Approved? [type: gateway]
    Shipped [type: event]
  }
}

Open website > Place order: Browse
Place order > Approved?
Approved? > Shipped: yes [color: green]
`,
};

export const isDiagramType = (t: string): t is DiagramType => t in TEMPLATES;
