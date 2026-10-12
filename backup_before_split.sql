--
-- PostgreSQL database dump
--

\restrict eijnMTgMREAR4Zvz1VTgIuADvlb6h8ozT7ZwP7DYHZppD4ACUqdTpZhhY4pElJA

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ManagementType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ManagementType" AS ENUM (
    'about',
    'terms',
    'privacy'
);


ALTER TYPE public."ManagementType" OWNER TO postgres;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Role" AS ENUM (
    'user',
    'admin'
);


ALTER TYPE public."Role" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Management; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Management" (
    id integer NOT NULL,
    type text NOT NULL,
    description text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Management" OWNER TO postgres;

--
-- Name: Management_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Management_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Management_id_seq" OWNER TO postgres;

--
-- Name: Management_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Management_id_seq" OWNED BY public."Management".id;


--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id integer NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    password text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    phone text NOT NULL,
    role public."Role" DEFAULT 'user'::public."Role" NOT NULL
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: User_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."User_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."User_id_seq" OWNER TO postgres;

--
-- Name: User_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."User_id_seq" OWNED BY public."User".id;


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: Management id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Management" ALTER COLUMN id SET DEFAULT nextval('public."Management_id_seq"'::regclass);


--
-- Name: User id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User" ALTER COLUMN id SET DEFAULT nextval('public."User_id_seq"'::regclass);


--
-- Data for Name: Management; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Management" (id, type, description, "createdAt", "updatedAt") FROM stdin;
1	about	RobinKeyz LLC test	2026-10-11 08:41:10.245	2026-10-11 08:41:10.245
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, email, name, "createdAt", password, "updatedAt", phone, role) FROM stdin;
1	sayed570018707@example.com	Abu Sayed	2026-10-11 08:41:10.363	$2b$10$YYMbzi9n59rq9CPPxotRxOZdPl1Qziv9XHJr/XdN68ba2ChT28c2S	2026-10-11 08:41:10.363	01712345678	user
2	abu@gmail.com	Abu Sayed	2026-10-11 08:52:24.49	$2b$10$O7ziZW4nTE8SdKM0C9lKkuaoKZ6dAk98IPsv0C/yl2Zg2SI.UZRw.	2026-10-11 08:52:24.49	01712345678	user
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
ff60f3c5-f115-4411-913d-e704c0bcd8f5	f1f637791ccff7f38a8f58461d4c79ec55d69849df5b892c8a68b963e353f97a	2026-10-11 08:18:33.311085+00	20260103090539_init	\N	\N	2026-10-11 08:18:33.287979+00	1
a3218d7e-5c19-4c91-ab07-9a69c709fe94	ae568268e455c2e13924bb293ec2bc0b5eabc98d7c55d6f6493ad17f00414ed9	2026-10-11 08:18:33.333615+00	20260113051536_init	\N	\N	2026-10-11 08:18:33.31328+00	1
64b15803-d852-44ba-8330-941727f86b40	081441612da895311020406f02e11ad889fa3028a7967b5ef3f151b3e4fd2e96	2026-10-11 08:18:33.342259+00	20260113053748_init	\N	\N	2026-10-11 08:18:33.335717+00	1
c3c95220-4c55-473b-be1e-09a163c498f3	6cdfc0ce81572f94a24a676d4d7d427ef41966c5861ccd6c406cdc8144c355a9	2026-10-11 08:18:33.350977+00	20260113054824_add_password_and_updated_at	\N	\N	2026-10-11 08:18:33.344678+00	1
64e163d5-b847-49cb-b06a-d33fe15b976e	73e1addaf54a6ac14350564f2b6cfc62cfb12351d1e22ff1cf125e98b8e25f31	2026-10-11 08:18:33.358285+00	20260119105728_init	\N	\N	2026-10-11 08:18:33.352917+00	1
5dde80b9-cde1-4c1a-8acf-19d7544f83e0	b0882db348ca2680881cc9f31bed80dbd014e135e82130db123e2aac4b22aeb3	2026-10-11 08:18:33.37376+00	20260209091420_init	\N	\N	2026-10-11 08:18:33.36043+00	1
2dc99ec8-4fa1-4cac-bf07-1db3682ecd6d	4216d1c9a5ec46d1fd70d828e2bff878e229e9db1460d6f32f1a22400f3ea0ce	2026-10-11 08:18:33.384762+00	20260218051233_add_unique_type	\N	\N	2026-10-11 08:18:33.375818+00	1
8c546905-b693-4bd7-8a96-686329628045	0a12b85891ca487ac9d848ca743d90981d23d7c70c66f45b8bc8ea51fc644e32	2026-10-11 08:18:33.393796+00	20260218083500_fix_management_type	\N	\N	2026-10-11 08:18:33.386707+00	1
980614b3-eb82-4add-b9da-0f927c6625c5	5b2526907fa60a0c8b6b03b4f1e3894d35029aa9c4cd86114835baa3bb356688	2026-10-11 08:18:33.401546+00	20260220092836_add_role_enum	\N	\N	2026-10-11 08:18:33.395887+00	1
\.


--
-- Name: Management_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Management_id_seq"', 1, true);


--
-- Name: User_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."User_id_seq"', 2, true);


--
-- Name: Management Management_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Management"
    ADD CONSTRAINT "Management_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Management_type_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Management_type_key" ON public."Management" USING btree (type);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- PostgreSQL database dump complete
--

\unrestrict eijnMTgMREAR4Zvz1VTgIuADvlb6h8ozT7ZwP7DYHZppD4ACUqdTpZhhY4pElJA

